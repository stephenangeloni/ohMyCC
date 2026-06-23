---
description: Apply a verified findings list as sequential fresh-agent commits
---

# /fleet-fix — Sequential Multi-Fix Pipeline (Fresh-Agent Mode)

You are running the `/fleet-fix` skill. This is the natural follow-up to `/fleet-review`:
the review surfaced a verified findings list, and the user wants those fixes applied
without paying the parent-context-clutter cost of doing them all in one conversation.

The core insight: **plan once, dispatch fresh agents one at a time, commit between
each.** A single planning agent reads all affected files, computes the exact edits
per fix, and writes a manifest. The coordinator (this skill conversation) then walks
the manifest's `commit_order` and, for each group, spawns ONE fresh fix-executor
agent. That agent applies the group's edits, runs its verify command, and returns a
short summary. The coordinator stages and commits exactly that group's files, then
disposes the agent and moves to the next group. The result is a linear `git log`
with one commit per group and a coordinator context that does not grow as the number
of fixes increases.

**What makes this different from sequential fixing in the parent conversation:**

- **Coordinator context stays flat**: only one teammate summary (~500 tokens) is
  in flight at a time, and it's discarded when the agent is disposed. The parent
  conversation never sees the raw tool results from any edit.
- **Reasoning depth per fix**: each agent attends to one problem with a fresh,
  empty context — full attention budget, no accumulated state from earlier fixes.
- **Reviewable**: the manifest is a real artifact the user can inspect and edit
  before approving execution.
- **Resumable**: if a group fails, the coordinator can retry just that group
  without re-deriving the others, then continue down the list.

**What changed from the previous team mode (and why):**

Earlier versions of this skill spawned a `TeamCreate`d squad of fix-executor
teammates in parallel inside the shared parent worktree. That bought ~3–5× wallclock
speedup, but at three real costs:

1. The coordinator absorbed N return summaries near-simultaneously, growing its
   context by O(N) per run — exactly what the user is trying to avoid.
2. Concurrent in-place edits to a shared filesystem required defensive logic
   (Step 1.5 file-overlap reconciliation) and exposed a real torn-write failure
   mode if the planner mis-grouped findings on a shared file.
3. Multi-failure recovery (one teammate fails while three others are mid-edit)
   needed an auto-fallback policy with classification rules and tier-stop semantics.

Sequential fresh-agent mode trades the parallelism for the clarity of those three
problems disappearing:

- The coordinator only ever sees one agent at a time. Context stays bounded.
- One agent edits the tree at a time. No concurrent writes, no race conditions.
- One agent fails at a time. Failure handling is "retry or surface to user", with
  no in-flight peers to coordinate around.

The trade-off is **wallclock**: 5 fixes take ~5× the time of 1 fix instead of ~1×.
For the typical `/fleet-fix` run (3–10 findings, mostly small edits), this
adds minutes, not hours, and the user does not have to babysit it — the coordinator
walks the list autonomously between commits.


## Input

The skill expects a verified findings list. Resolution order:

1. **Handoff file from `/fleet-review`** — `.fleet-review/findings.md` at the git
   repo root. `/fleet-review` writes this in its Step 6.5 specifically so the user
   can `/clear` between review and fix without losing the bridge. This is the
   primary input path and should be checked first.
2. **Inline in the current conversation** — the user pasted findings or just ran
   `/fleet-review` and didn't clear. The post-verification summary already groups
   findings by ID, severity, file, and verification status; use it verbatim.
3. **User-supplied bullet list** — less structured but workable as long as each
   entry has a file path and a short title.

### Step 0.0: Check for handoff file

Before anything else, look for the file:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
FINDINGS_FILE="$REPO_ROOT/.fleet-review/findings.md"
if [ -f "$FINDINGS_FILE" ]; then
  echo "FOUND: $FINDINGS_FILE"
  # Show the user the file's header so they can confirm it's the run they want:
  head -5 "$FINDINGS_FILE"
fi
```

If the file exists, read it with the Read tool and use its findings as the input.
Confirm with the user via `AskUserQuestion` before planning — the file might be
stale from an earlier review:

```
AskUserQuestion({
  questions: [{
    question: "Found .fleet-review/findings.md from <timestamp from file header> (<N> confirmed findings). Use it as input?",
    header: "Handoff file",
    multiSelect: false,
    options: [
      { label: "Yes, use this file",   description: "Read findings from .fleet-review/findings.md and plan from there" },
      { label: "Ignore, use conversation", description: "I have a fresher findings list in this conversation — use that instead" },
      { label: "Cancel",                description: "Stop /fleet-fix; the findings file is stale and I want to re-run /fleet-review first" }
    ]
  }]
})
```

If no handoff file exists and the conversation has no findings either, ask the user
to supply them or to run `/fleet-review` first.

### Missing field handling

If the input (from any source) doesn't include `file` and `title` per finding, ask
the user for those two fields before planning. Without them the planner can't read
the right files. Use `AskUserQuestion` so the choice is structured rather than
free-form prose:

```
AskUserQuestion({
  questions: [{
    question: "Findings list is missing file path and/or title for some entries. How should I proceed?",
    header: "Missing fields",
    multiSelect: false,
    options: [
      { label: "I'll paste a fuller list", description: "You re-supply findings with `file:` and `title:` for each entry" },
      { label: "Infer from descriptions",  description: "Spawn the planner with what we have; risk reading wrong files" },
      { label: "Cancel",                    description: "Stop /fleet-fix here" }
    ]
  }]
})
```


## Convention: ask the user via `AskUserQuestion`, not free-form prose

Every decision point in this skill where the user must choose between named outcomes
MUST be expressed through the `AskUserQuestion` tool, not as a printed prompt that
expects the user to type a reply. This applies to: preflight WIP handling, plan
approval, agent-error recovery, verifier anomalies, and per-group commit failures
(covered in detail below). Reasons:

- The user gets selectable options instead of having to compose a reply.
- The skill's branch logic is deterministic — no natural-language parsing.
- The set of valid responses is self-documenting; future readers of this SKILL see
  exactly which paths each fork point allows.

When a decision genuinely needs free-form input ("rename G1 to X", "merge G2 into
G1, but keep G3 separate"), include an `Other (specify)` option in the
`AskUserQuestion` and let the user follow up with the details in their next turn.
Do not skip `AskUserQuestion` just because some adjustments need free text.


## Step 0: Preflight

```bash
# We need a git repo and an idea of the parent's WIP state.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not in a git repo — fleet-fix needs git for per-group commits."; exit 1;
}

# Detect uncommitted changes. Fix-executor agents work in this exact tree, so
# existing WIP will be staged alongside the agents' edits when the coordinator
# commits. That is almost never what the user wants — surface it explicitly.
if ! git diff-index --quiet HEAD --; then
  echo "WARN: uncommitted changes in working tree — they will be entangled with agent edits."
fi

PARENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
PRE_RUN_SHA=$(git rev-parse HEAD)   # used by the rollback hint at the end
echo "PARENT_BRANCH=$PARENT_BRANCH PRE_RUN_SHA=$PRE_RUN_SHA"
```

If the parent has uncommitted changes, ask the user how to handle them via
`AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Working tree has uncommitted changes. Fix-executor agents edit this tree directly, so the per-group commits will entangle with your WIP. How should I handle it?",
    header: "Uncommitted WIP",
    multiSelect: false,
    options: [
      { label: "Commit first",      description: "Make a WIP commit on the current branch so per-group commits land cleanly on top" },
      { label: "Stash",             description: "git stash push -u; you can pop it after fleet-fix completes" },
      { label: "Proceed anyway",    description: "WIP stays in the tree; it WILL be staged into the first group's commit. Only safe if you already intended that." },
      { label: "Cancel",            description: "Stop /fleet-fix here so you can sort out the WIP manually" }
    ]
  }]
})
```

The skill operates entirely in the parent's working tree and does not create any
worktrees, branches, or temp directories outside `/tmp` for the manifest.


## Step 1: Plan phase — read files, compute edits, write manifest

Spawn ONE planning agent (use the strongest model — Opus / xhigh effort). The planner's
job is to read every file referenced in the findings, reason about each fix once, and
emit a structured manifest. This is the only "expensive cognition" step in the pipeline;
everything downstream is mechanical.

**Planner prompt template:**

```
You are a fix-planning agent. Below is a verified findings list. Read every file
referenced, reason through each fix carefully, and emit a JSON manifest of edits to
apply. Each manifest entry must be a self-contained unit a downstream agent can apply
without further reasoning.

Findings:
[paste the verified findings list]

OUTPUT FORMAT (strict JSON, no prose, no markdown fences):
{
  "groups": [
    {
      "id": "G1",
      "title": "<short title for this commit>",
      "findings": ["A", "D", "I"],
      "files_touched": ["path/to/file1.ts", "path/to/file2.tsx"],
      "rationale": "<2-3 sentences: why these findings group together; what design choice was made>",
      "edits": [
        {
          "file": "path/to/file.ts",
          "old_string": "<exact existing text>",
          "new_string": "<replacement text>",
          "reason": "<one line: which finding this addresses>"
        }
      ],
      "tests_to_add": [
        {
          "file": "path/to/file.test.ts",
          "after_marker": "<existing test name or string to anchor the insertion>",
          "test_block": "<the full it(...) or test(...) block>"
        }
      ],
      "verify_command": "pnpm test path/to/file.test.ts",
      "commit_message": "<imperative-mood subject line>\n\n<body explaining what + why>",
      "depends_on": []
    }
  ],
  "commit_order": ["G1", "G2", "G3"],
  "notes": "<any cross-cutting decisions the user should review before apply>"
}

GROUPING RULES:
1. Group findings that share a design decision OR touch the same file region into
   one group. Two findings on the same file that need different approaches can be
   separate groups — execution is sequential, so concurrent-write races are not a
   concern. Group by logical cohesion, not by file overlap.
2. If group B genuinely needs group A's type/API change, add A to B's `depends_on`.
   The coordinator commits in dependency-respecting order regardless.
3. Aim for one group per concern. Don't pack unrelated fixes together "to make
   fewer groups" — coordinator overhead per group is minimal in sequential mode.
4. `commit_order` must be a topological sort of the groups by `depends_on`. Cycles
   are an error — re-think the grouping.

EDIT RULES:
1. `old_string` MUST appear exactly once in the target file (or use enough surrounding
   context to make it unique). Downstream agents use the Edit tool, which fails on
   ambiguous matches.
2. Don't add unrelated cleanups to a fix's edits. Scope creep ruins reviewability.
3. If a fix requires reading the file to know the right replacement, do that reading
   now — the manifest must be complete enough that the executor doesn't need to think.
4. If group B depends on group A, B's `old_string` snapshots should reflect the file
   state AFTER A's edits land. The planner must mentally apply A before computing B.

TEST RULES:
1. Every group MUST add at least one test that fails BEFORE the edits and passes
   AFTER. If a finding can't be tested, write that into `notes`.
2. Tests live in the same group as the fix they cover.
3. `verify_command` runs only the new/affected tests, not the full suite — keeps
   per-agent wallclock low. The coordinator runs the full suite at the end.
```

Save the planner's output to `/tmp/fleet-fix-manifest.json`. Validate it parses as JSON
and has the required fields. If it doesn't, ask the planner to retry; do NOT manually
patch the JSON.

Then validate `commit_order` is a valid topological sort of `groups` by `depends_on`.
If a cycle exists, STOP and surface to the user — the manifest has contradictory
dependencies and the planner needs to be re-run. (No file-overlap reconciliation
step is needed: sequential execution makes concurrent-write races impossible.)


## Step 2: Confirm with user

Print a compact summary of the plan to the conversation, then call
`AskUserQuestion` so the user picks an explicit next action rather than typing prose:

```
FLEET-FIX PLAN — N groups, M findings (SEQUENTIAL MODE)

COMMIT ORDER (one fresh agent per group, dispatched in this order):
  G1 — <title> (touches: file1.ts, file2.tsx) — fixes [A, D, I]
  G2 — <title> (touches: file3.ts) — fixes [F, G, H]
  G3 — <title> (touches: file4.ts) — fixes [B, C]
       depends on: G1
       reason: needs RecurringTemplate.pdfTheme field added in G1
  G4 — <title> (touches: file5.ts) — fixes [J, K, L, M]

CROSS-CUTTING NOTES:
  <planner.notes contents>
```

Then:

```
AskUserQuestion({
  questions: [{
    question: "Proceed with this fleet-fix plan?",
    header: "Approve plan",
    multiSelect: false,
    options: [
      { label: "Yes, start execution", description: "Walk commit_order; spawn one fresh agent per group, commit, dispose, advance" },
      { label: "Adjust or inspect",    description: "Free-form follow-up: print one group's full edits, reorder/split/merge groups, or change scope before approving" },
      { label: "Apply in coordinator", description: "Skip the agent dispatch; apply fixes one-by-one directly in this conversation (only when the manifest is small enough that context cost is acceptable)" },
      { label: "Cancel",               description: "Abort /fleet-fix" }
    ]
  }]
})
```

Branching:

- **Yes** → proceed to Step 3.
- **Adjust or inspect** → ask a free-text follow-up ("Which group's edits should I
  print, or describe the change you want") and update the manifest in-place. Don't
  re-spawn the planner unless the change is structural enough to need new edits
  computed. Re-prompt for approval after.
- **Apply in coordinator** → skip the dispatch loop; apply each group's edits
  directly using the Edit tool in this conversation, run each verify command, and
  commit per-group. This is the in-context fallback — useful when the manifest is
  small (≤ 2 groups) and the per-agent dispatch overhead is not worth paying.
- **Cancel** → exit cleanly.


## Step 3: Sequential dispatch — one fresh agent per group

This is the heart of the new design. The coordinator walks `manifest.commit_order`.
For each group in turn, it:

1. Writes the group's manifest slice to `/tmp/fleet-fix-G<N>.json`.
2. Spawns ONE fresh `Agent` with a focused prompt pointing at that slice.
3. Waits for the agent to return (foreground — `run_in_background` is NOT used here).
4. Parses the agent's return JSON. On success, stages and commits that group's files.
5. The agent is disposed; its context is gone. Move to the next group.

There is no team, no `TeamCreate`, no `SendMessage`, no parallel dispatch. Each
agent is a one-shot worker.

### Step 3.1: Per-group dispatch

For each group `Gi` in `manifest.commit_order`:

```
# Write the group's manifest slice (one file per group keeps the agent prompt tiny):
write_json("/tmp/fleet-fix-G<N>.json", manifest.groups[i])

# Spawn the fix-executor. Sonnet is enough for mechanical edit application; bump
# to Opus only if the group's edits are unusually complex (the planner can flag
# this in `notes`).
Agent({
  description: "Fix-executor: G<N>",
  subagent_type: "general-purpose",
  model: "sonnet",
  run_in_background: false,   # we WAIT for this agent before dispatching the next
  prompt: `
You are a fix-executor agent operating in the parent worktree at <PROJECT_ROOT>.
You are the only agent currently editing this tree. Apply the manifest group below
EXACTLY as specified, run the verify command, then return a JSON summary — do NOT
commit; the coordinator will stage and commit your group's files after you finish.

You ARE allowed to read files outside files_touched. You MUST NOT edit anything
outside files_touched + tests_to_add[].file. Do not run \`git add\`, \`git commit\`,
or any other git state-mutating command.

Working directory: <PROJECT_ROOT>
Group manifest: /tmp/fleet-fix-G<N>.json

EXECUTION STEPS:
1. cd to <PROJECT_ROOT>. Run \`git rev-parse --abbrev-ref HEAD\` to confirm you are on
   <PARENT_BRANCH>. If not, STOP and return ERROR.
2. Read /tmp/fleet-fix-G<N>.json. It contains: id, title, findings, files_touched,
   rationale, edits[], tests_to_add[], verify_command, commit_message.
3. For each entry in edits[]: use the Edit tool with the exact old_string/new_string.
   If a match fails (old_string not unique or not found), STOP and return ERROR with
   the failing edit's index and the current file content around the expected match.
   Do NOT attempt to fix the failure yourself.
4. For each entry in tests_to_add[]: read the test file, locate after_marker, insert
   test_block immediately after the closing brace of the matched test/it block. Use
   Read+Edit, not Write.
5. Run the manifest's verify_command via Bash from the project root. If it fails,
   STOP and return ERROR with the failure output. Do NOT iterate.
6. On success, return a JSON-shaped summary:
   { "group": "G<N>", "files_changed": [<absolute paths>], "verify": "PASS",
     "deviations": ["<one-line note per intentional in-scope adjustment>"] }
7. DO NOT commit. DO NOT push. DO NOT run \`git add\`. The coordinator handles commits.

DO NOT:
- Touch git state (no add, commit, push, branch, checkout, reset).
- Edit files outside files_touched + tests_to_add[].file.
- Run the full test suite. Only the verify command for this group.
- Skip the verify step.
- Return success if any step failed.
  `
})

# Block until the agent returns. Parse its JSON output.
```

### Step 3.2: Coordinator stages and commits

On a successful agent return:

```bash
# In the parent's working directory, stage exactly the group's files. Use explicit
# paths rather than `git add -A` so any pre-existing WIP outside the group's scope
# stays out of this commit.
git add <space-separated paths from files_touched + tests_to_add[].file>

# Verify the staged set is exactly what we expect — nothing else snuck in:
git diff --cached --name-only

# Commit with the manifest's commit_message via HEREDOC for multi-line bodies:
git commit -m "$(cat <<'EOF'
<commit_message body>
EOF
)"

# Capture the commit SHA for the run summary:
COMMIT_SHA=$(git rev-parse HEAD)
```

If the staged set differs from the agent's reported `files_changed` (e.g., the
agent silently edited a file outside `files_touched`), STOP the run and surface
to the user — the verifier (Step 4) will also flag this, but it's faster to catch
here before more groups land on top.

**If a `package.json`, `pnpm-lock.yaml`, or other dependency manifest is in this
group's `files_touched`:** after committing the group, run the project's install
command (`pnpm install` for this project) before dispatching the next group.
Subsequent groups may need the new deps to run their verify command. The skill
detects this by checking whether any committed file matches `package.json`,
`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements.txt`,
`pyproject.toml`, `Cargo.toml`, `go.sum`, etc.

### Step 3.3: Failure handling — single-agent retry then surface

A fix-executor can fail in a handful of ways. Sequential mode keeps recovery
simple: there are no in-flight peers, no torn writes, no race conditions to
unwind.

| Symptom in agent output                                           | Class            | Action                                                |
| ----------------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| "old_string not found", "no match", "not unique"                  | manifest_drift   | revert any partial writes; one auto-retry with fresh agent (re-reads file); if still failing, surface |
| "ENOENT", missing config file                                     | env_missing      | check parent's tree for the file; if absent → surface; if present → auto-retry |
| "auth" / "MFA" / "Clerk" / "test-user" failure during E2E setup   | bootstrap_missing| skip verify (note in commit message); commit edits anyway after asking user |
| typecheck / lint / unit-test assertion failure                    | logic_failure    | surface to user — the planner's edit was wrong, not the executor's interpretation |
| "merge conflict" / "uncommitted changes" before edits             | env_dirty        | abort run; surface to user (this should not happen if Step 0's WIP question was answered) |
| timeout / no progress after 10 min                                | hung             | kill agent; one auto-retry with fresh agent; if still failing, surface |

**Auto-retry recipe** (used for `manifest_drift`, transient `env_missing`, `hung`):

```bash
# Revert any partial writes the failed agent may have made:
git checkout -- <files_touched + tests_to_add[].file>

# Re-spawn a fresh Agent with the same group manifest slice. The fresh context
# means the agent re-reads each file before applying — useful when the planner's
# old_string snapshot was slightly stale (e.g., line endings or whitespace).
Agent({ ...same prompt as Step 3.1... })
```

If the auto-retry succeeds, proceed to Step 3.2 and commit. If it fails again, do
NOT loop indefinitely — surface to the user via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Group <Gi> failed twice (<class>: <one-line summary>). How should I proceed?",
    header: "Group failed",
    multiSelect: false,
    options: [
      { label: "Apply this group in coordinator", description: "I'll read the failing edits and apply them here, with you watching. Costs context but unblocks the run." },
      { label: "Skip this group",                  description: "Move on to the next group. Downstream groups that depend on this one will be skipped too." },
      { label: "Re-plan this group",               description: "Spawn a fresh planner agent for just this group's findings to recompute the edits, then retry." },
      { label: "Abort run",                         description: "Stop /fleet-fix here. Already-committed groups stay; you can revert them from the run summary." }
    ]
  }]
})
```

When a group is **skipped**, propagate the skip to its dependents: any group whose
`depends_on` includes a skipped group is also skipped automatically (announce in
the run summary). This avoids dispatching agents whose `old_string` snapshots
assume an upstream change that never landed.


## Step 4: Verify phase — cross-check each commit

Once all groups in `commit_order` have either committed or been recorded as
skipped, spawn ONE verifier agent (xhigh effort). The verifier checks every
landed commit's diff against the manifest's intent — catches scope creep, missed
edits, or output that drifted from the plan.

The verifier is a fresh `Agent` call (no team, same as Step 3's executors).

**Verifier prompt:**

```
You are a verification agent. Below are commits produced by sequentially-dispatched
fix-executor agents working from a shared manifest. Independently verify each
commit by:

1. \`git show <SHA>\` to read the actual diff
2. Compare against the manifest entry for that group
3. Report any discrepancy:
   - SCOPE_CREEP: edits to files not in files_touched
   - MISSING_EDIT: a manifest edit that didn't land
   - INCORRECT_EDIT: the diff doesn't match new_string
   - TEST_GAP: tests_to_add entries missing
   - OK: commit matches manifest exactly (within-scope deviations like adapting
     old_string to upstream changes from a dependency commit are FINE)

Manifest: /tmp/fleet-fix-manifest.json
Commits to verify (group → SHA):
G1: <SHA>
G2: <SHA>
...

Output format per commit:
VERDICT:
  group: G1
  status: OK | SCOPE_CREEP | MISSING_EDIT | INCORRECT_EDIT | TEST_GAP
  detail: <one line per anomaly, with file:line>

End with a SUMMARY block: total_commits, ok, flagged, scope_creep_groups[],
recommended_action (accept_all | accept_ok_only | re-fix_flagged | abort).
```

After the verifier returns, if any verdict is non-OK, surface the anomalies and ask
the user how to proceed via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Verifier flagged anomalies on <N> group(s): <comma-list of group_ids with status>. How should I proceed?",
    header: "Verifier anomalies",
    multiSelect: false,
    options: [
      { label: "Accept all",            description: "Trust the diffs; keep all commits including the flagged ones" },
      { label: "Revert flagged groups", description: "git revert the flagged commits; keep OK commits as the final state" },
      { label: "Re-fix flagged groups", description: "Revert the flagged commits, then re-dispatch fresh agents for them in commit_order; keep OK groups as-is" },
      { label: "Show diffs",            description: "Print git show for each flagged group, then re-prompt this question" }
    ]
  }]
})
```

If all verdicts are OK, skip the question and proceed straight to Step 5.


## Step 5: Wrap-up phase — full-suite verification

Commits already exist on `<PARENT_BRANCH>` from Step 3.2's per-group commits.
Step 5 is a single full-suite test run plus a typecheck to catch cross-group
regressions that per-group verify commands wouldn't have surfaced.

```bash
# Run from the parent's working directory:
<full-suite command from project conventions, e.g. `pnpm exec vitest run` or `pytest`>
<full-typecheck command, e.g. `pnpm exec tsc --noEmit`>
```

If either fails, the user has clean rollback paths:

- **Revert just one group**: `git revert <commit-sha>` — commits are linear in
  sequential mode, so no `-m 1` is needed. The skill should print this command
  for each committed group so the user can pick.
- **Revert all `/fleet-fix` work**: `git reset --hard <PRE_RUN_SHA>` where
  `<PRE_RUN_SHA>` is `<PARENT_BRANCH>` at the moment Step 0 captured it.

Don't run any rollback automatically. Just print the options.


## Step 6: Cleanup

```bash
# Remove the manifest tempfile and per-group slices.
rm -f /tmp/fleet-fix-manifest.json /tmp/fleet-fix-G*.json
```

If the run was driven by `.fleet-review/findings.md` (the handoff file from
`/fleet-review`), archive it instead of deleting outright — the user may want to
diff old vs. next-round findings:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
FINDINGS_FILE="$REPO_ROOT/.fleet-review/findings.md"
if [ -f "$FINDINGS_FILE" ]; then
  ARCHIVE="$REPO_ROOT/.fleet-review/findings.$(date +%Y%m%d-%H%M%S).applied.md"
  mv "$FINDINGS_FILE" "$ARCHIVE"
  echo "Archived → $ARCHIVE"
fi
```

This keeps the directory ready for the next `/fleet-review` run without losing
history. If the run was aborted or had skipped groups, leave the file in place
instead — the user may want to re-run `/fleet-fix` against the same findings
after fixing the underlying issue.

There are no teams to dispose, no worktrees, no branches, and no env files to
clean up.

Print a final summary:

```
FLEET-FIX COMPLETE (SEQUENTIAL MODE)

Commits on <PARENT_BRANCH> (newest → oldest):
  abc1234  <G1's commit_message subject>  (fixes A, D, I)
  def5678  <G2's commit_message subject>  (fixes F, G, H)
  ...

Per-group commit SHAs (for selective revert if needed):
  G1 → abc1234
  G2 → def5678
  ...

Skipped groups (if any, with reason):
  G3 → skipped (logic_failure: planner edit didn't pass tests; user chose Skip)
  G5 → skipped (upstream G3 was skipped)

Full suite: PASS  (N tests passed)
Typecheck:  PASS

Rollback hint:
  Revert one group:  git revert <sha>
  Revert all:        git reset --hard <PRE_RUN_SHA>
```


## Important rules

- **Agents never commit.** Only the coordinator runs `git add` / `git commit`.
  This is what makes per-group commits clean and keeps the agents stateless.
- **Agents never `git add -A`.** The coordinator uses explicit paths so any
  pre-existing WIP outside the group's scope stays out of the commit.
- **One agent at a time.** No `TeamCreate`, no `run_in_background=true` for
  fix-executors, no parallel dispatch. The whole point of sequential mode is
  that the coordinator's context never holds more than one agent's summary at
  once.
- **Never auto-resolve verifier anomalies.** Ask the user.
- **Never skip a group's verify command.** If the manifest doesn't make tests
  pass, surface that as a planner bug, not an executor responsibility.
- **Never expand an agent's scope.** If a fix-executor notices something fixable
  that wasn't in its manifest, it must NOT touch it — log a note in `deviations`
  for the user instead. Scope creep destroys reviewability.
- **Manifest is a real artifact.** Save it to `/tmp/fleet-fix-manifest.json`. The
  user should be able to read it, hand-edit it, and re-run from "Step 3" if they
  want.
- **Plan once, execute many.** If the planner's manifest is wrong, fix the
  planner prompt or the input findings — don't paper over it in the executor.
- **Skipped groups propagate.** Any group whose `depends_on` includes a skipped
  group is auto-skipped, recorded in the run summary, and not dispatched.


## When to apply in-coordinator instead of dispatching agents

The "Apply in coordinator" branch in Step 2 is for cases where the per-agent
dispatch overhead is genuinely larger than the context cost of doing the edits
directly in this conversation:

- Total findings ≤ 2 (each fresh-agent spawn costs more context than the edit
  itself would).
- All findings touch the same single file with trivial edits (no real benefit
  from a separate agent).

For everything else, prefer the agent-per-group dispatch. The whole reason this
skill exists is to keep the coordinator's context flat as the number of fixes
grows — and that benefit appears starting at ~3 groups.


## Cost vs. benefit ledger (for skill self-awareness)

Sequential-in-coordinator cost (baseline): ~30K tokens for 5 fixes in this
codebase. The coordinator absorbs every tool result from every Edit call.

Old team-mode cost (manifest + parallel teammates): ~45K tokens, ~3 min wallclock.
Faster wallclock but the coordinator still absorbed N return summaries near
simultaneously, so context grew O(N).

Sequential fresh-agent cost (this design): ~35K tokens, ~10–15 min wallclock for
5 fixes. Coordinator context is FLAT in N — only one agent's summary is in flight
at a time, and it's discarded after the commit.

Wins (sequential fresh-agent mode):
- Coordinator context stays bounded as fixes scale.
- Each fix-executor has a fresh, empty context — full attention budget per fix.
- No torn-write races, no file-overlap reconciliation, no multi-failure
  classification rules.
- Reviewable manifest artifact; resumable on per-group failure.
- Linear, bisectable `git log` with one commit per group.

Losses (vs. old team mode):
- ~3–5× wallclock — fixes run end-to-end, not in parallel.
- Doesn't help when fixes are <3 (the in-coordinator branch is faster there).

Use when you have 3+ verified findings and want the coordinator's context to stay
bounded regardless of how many fixes are in the run.
