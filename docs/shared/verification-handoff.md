# Verification Handoff

Canonical spec for what a caller gives the `verifier` agent before it runs: the
**depth** (chosen by the user) and the **Prior checks ledger** (the checks the
caller already ran). This file is the single source of the ledger format.
Callers point here instead of copying it, and `agents/verifier.md` keeps only the
short triage rules. The outbound half, how the verifier returns its verdict, is
`docs/shared/agent-return-contract.md`.

## The problem this prevents

A verifier that trusts nothing runs every check again, even when the caller
already ran the same checks on the same bytes and quoted the results. Real case:
a two-line SQL fix. The caller ran 6 check scripts and a rebuild against
recorded file hashes and quoted each result. The verifier ran all 6 and the
rebuild again, and each gave the same result. Its useful findings came from
reading: one check's regex was narrower than its docstring, and a written run
instruction was confirmed true to the code. The repeated runs cost minutes and
tokens and added no evidence.

With a ledger, the verifier confirms that the bytes are the same, reads every
check to decide whether it proves its claim, and spends its runs on what nobody
has checked yet.

Independent review is opt-in: a caller hands work to `verifier` only when the user
asks for review, or inside a workflow the user started that has a review stage
(`team`, `ralph`, `autopilot`). When a review runs, it is still a separate pass,
and a claim without a command and a quoted result is still rejected. Everything
below applies once a review is going to run.

## 1. Ask the user for the depth

Before each handoff to `verifier`, measure the change and ask the user how deep
the verification goes.

1. **Measure.** Run `git diff --shortstat <start>` and `git diff --name-only <start>`,
   where `<start>` is the commit the task started from, and add untracked files
   from `git status --porcelain`. Note high-risk paths: security or auth, data
   loss or a destructive operation, a migration, a release.
2. **Recommend.** Use the size thresholds of `docs/shared/verification-tiers.md`:

   | Recommend | When |
   |-----------|------|
   | Thorough | a high-risk path, more than 20 files, or no checks run yet (no ledger) |
   | Quick | fewer than 5 files and 100 changed lines, and deterministic ledger checks cover every acceptance criterion |
   | Standard | everything else |

   Never recommend Skip.
3. **Ask** with `AskUserQuestion`, the recommended option first:

   ```
   AskUserQuestion({
     questions: [{
       header: "Verify depth",
       question: "Change: 2 files, +4/-2 lines, no high-risk paths. Checks already run: 7, all deterministic. How deep should the verifier go?",
       multiSelect: false,
       options: [
         { label: "Standard (Recommended)", description: "Confirm hashes, read every check, re-run one as a spot check, review regression risk and the unchecked items" },
         { label: "Quick", description: "Confirm hashes, read every check, examine only the unchecked items; no re-runs" },
         { label: "Thorough", description: "Run every check again, plus tests, diagnostics and build" },
         { label: "Skip", description: "No verifier; the work is reported as not independently verified" }
       ]
     }]
   })
   ```

Do not ask when:

- the user already named a depth, or said to skip verification, for this task;
- the run already has an answer. Autonomous modes (`team`, `ultrawork`) ask once
  before the first handoff and reuse the answer. They ask again only when a
  high-risk path appears or the change grows into a higher recommendation;
- no user can answer (a subagent, a background or non-interactive session). Use
  the recommended depth and state it in the handoff.

**Skip.** Only the user can choose Skip; an agent never picks it for itself. No
verifier runs. The caller must not call the work verified: its report says "not
independently verified (user chose Skip)" and lists the checks it ran itself.
Skip is not self-approval, because no approval exists.

## 2. Build the ledger

Put a `## Prior checks ledger` block in the verifier's prompt. It has four parts.

1. **Artifacts.** Each path the claims are about, with its identity:
   - a content hash: `shasum -a 256 <path>` (sha256) or `md5 -q <path>` (`md5sum` on Linux); or
   - a commit SHA with a clean tree for that path: record `git rev-parse HEAD`
     while `git status --porcelain -- <path>` is empty. The verifier confirms it
     with `git diff --quiet <sha> -- <path>`.

   Take identities after the last edit. A check that ran before the last edit to
   its artifact is not a ledger item.
2. **Checks run.** One row per check: the claim it covers, the exact command, the
   quoted result line (verbatim), and whether the check is deterministic (no
   network, clock or random input). Every row ran against the identities above.
3. **Not yet checked.** The claims and risks the verifier must examine. List what
   you did not check. An omission does not narrow the review: the verifier also
   examines any acceptance criterion that no accepted item covers.
4. **Depth.** `quick` | `standard` | `thorough`, from step 1, with an optional
   budget hint (for example "about 10 tool calls").

Example:

```
## Prior checks ledger
Artifacts:
- src/report.sql  md5 68aeaa5b...
- README.md       md5 d94316d1...
Checks run (against the hashes above):
| # | Claim | Command | Quoted result | Deterministic |
|---|-------|---------|---------------|---------------|
| 1 | only lines 2128 and 2229 changed | python3 scripts/check_fix.py before.sql | "36 assertions passed, 0 failed" | yes |
| 2 | static rules hold | python3 scripts/checks.py | "0 issue(s)" | yes |
Not yet checked (focus):
- the README resume instruction is true to the code
Depth: standard
```

## 3. Depths

| Depth | What the verifier does |
|-------|------------------------|
| `quick` | Identity check, adequacy review of every ledger check, the "Not yet checked" items, and any acceptance criterion that no accepted item covers. No new runs of accepted items. |
| `standard` | `quick`, plus a new run of ONE cheap accepted item that the verifier picks as a spot check, plus a short regression-risk review. Default when a ledger is present. |
| `thorough` | Full verification: every check runs again, plus the test suite, diagnostics and build. |

No ledger: the verifier does full verification, and its report says:
"No prior checks ledger was given; full verification done."

The verifier may raise the depth, with a stated reason: an identity mismatch, an
inadequate check, a high-risk change (security, data loss, a destructive
operation, a release), or a failed spot check. It never lowers the depth the
caller asked for.

## 4. Verifier triage

1. **Identity first.** One cheap command recomputes every identity. A mismatch
   voids every ledger item on that artifact.
2. **Adequacy review, never skipped.** The verifier reads each check's source (the
   script or test) and decides whether it proves its claim. A check that only
   proves that two texts agree does not prove behavior. A check narrower than its
   claim is a finding.
3. **Accept without a new run only when all hold:** the identity matches, the
   exact command and a quoted result are present, the check is deterministic, and
   the adequacy review passed.

| Triage | When | What the verifier does |
|--------|------|------------------------|
| ACCEPTED | all four conditions hold | Uses the quoted result (Source LEDGER). The `standard` spot check runs one again (Source RE-RUN); a different result is a failed spot check. |
| RE-RUN | the check proves its claim, but the identity changed, the check is not deterministic, or the depth is `thorough` | Runs it again (Source RE-RUN). |
| REJECTED | the exact command or quoted result is missing, the check does not prove its claim, or it is not deterministic and the verifier does not run it | Writes and runs a check that does, for example a narrower deterministic one (Source NEW), or reports the gap. |

The verifier prompt states the rule for a check it does not run:
"RE-RUN means you ran it. A non-deterministic item you do not run is REJECTED; cover its claim with a narrower deterministic check, or list it as a gap."

## 5. Report

The verifier's report adds:

- a **Ledger triage** table: each item, ACCEPTED / RE-RUN / REJECTED, and the reason;
- a **Source** column in the Evidence table: LEDGER / RE-RUN / NEW;
- a **Depth** line in the Verdict, with the reason when it was raised.

The `OMC-VERDICT:` sentinel and the verdict vocabulary do not change.

Illustrative triage of the example ledger above, at `standard`:

```
### Ledger triage
| # | Ledger item | Triage | Reason |
|---|-------------|--------|--------|
| 1 | only lines 2128 and 2229 changed | ACCEPTED | md5 matches; deterministic; the script asserts both lines; spot check gave "36 assertions passed, 0 failed" again |
| 2 | static rules hold | REJECTED | the rule regex in checks.py is narrower than its docstring; gap reported, wider check written |

### Evidence
| Check | Result | Source | Command | Output |
|-------|--------|--------|---------|--------|
| only lines 2128 and 2229 changed | pass | RE-RUN | python3 scripts/check_fix.py before.sql | 36 assertions passed, 0 failed |
| static rules, wider pattern | pass | NEW | python3 <scratch>/checks_wide.py | 0 issue(s) |
| README resume instruction | pass | NEW | read README.md against the code | the instruction matches the code |
```

## Caller checklist

- [ ] The user chose the depth, the task already had one, or no user can answer and the recommended depth is stated.
- [ ] Identities were taken after the last edit.
- [ ] Every check row has the exact command and the verbatim result line.
- [ ] Checks that use the network, the clock or random input are marked `no`.
- [ ] "Not yet checked" lists what you did not check.
- [ ] The verifier runs on sonnet or a stronger model; never pass `model: "haiku"` for it, because accepting a check without re-running it takes judgment.

## Consumers

- `agents/verifier.md`: the triage rules.
- `docs/CLAUDE.md` (the installed OMC block), `CLAUDE.md`, `.github/CLAUDE.md`: the delegation lines in `<verification>`.
- `skills/team/SKILL.md`: `team-verify`.
- `skills/omc-reference/SKILL.md`, `src/hooks/keyword-detector/ultrawork/default.ts`, `src/agents/definitions.ts`: delegation guidance.
- `docs/shared/workflow-gating.md`: the separate verifier lane.

Reviewers that are not `verifier` do not read a ledger yet: ralph's completion
gate (architect, critic or Codex) and autopilot Phase 4 (architect,
security-reviewer, code-reviewer).
