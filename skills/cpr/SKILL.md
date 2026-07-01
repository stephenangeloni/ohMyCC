---
name: cpr
description: Commit, push, and open a PR via one fresh git-master subagent so the parent context never ingests the diff
---

# /cpr — Commit · Push · PR (Fresh-Agent Mode)

You are running the `/cpr` skill. This is the context-thrifty equivalent of the
upstream `commit-commands:commit-push-pr` command. Instead of injecting
`git diff HEAD` into **this** conversation and crafting the commit message + PR
body here, you dispatch the entire commit → push → PR flow to **one fresh
`git-master` subagent (sonnet)**. The subagent reads the full diff in its own
context window and returns only a compact summary. The parent conversation never
sees the raw diff or the intermediate git/gh tool output.

**The core insight:** the dominant context cost of "commit, push, and open a PR"
is `git diff HEAD` — easily tens of thousands of tokens for a large change,
dumped into your window before you do anything useful with it. A fresh subagent
is a context *firewall*: the diff crosses into it, and only `{branch, commit SHA,
PR URL, one-line summary}` crosses back.

## Hard rule: do NOT read the diff in the parent

The parent (this conversation) **must not** run `git diff`, `git diff HEAD`,
`git show`, or dump `git status` output into context. That would defeat the
entire purpose. The subagent runs those itself. The parent's only contribution is
a short **intent summary** (below).

## Step 1 — Write the intent summary (parent's only contribution)

A fresh subagent can see *what* changed (the diff) but not *why*. A good PR body
explains motivation, not just mechanism. So before dispatching, write a concise
2–3 sentence summary of **what changed and why**, drawn from the current
conversation:

- If you did the work in this session, you know the intent — summarize it.
- If `$ARGUMENTS` carries extra intent / emphasis, fold it in.
- If you have **no** knowledge of the changes (e.g. they were made outside this
  session), say so explicitly in the dispatch prompt — the subagent will infer
  from the diff alone (no worse than upstream `commit-push-pr`).

Keep it short. This summary, plus `$ARGUMENTS`, is the only context the parent
spends. Do not pad it with file lists or diff content.

## Step 2 — Parse `$ARGUMENTS` for overrides

`$ARGUMENTS` may carry optional directives. Thread any that are present into the
dispatch prompt; otherwise use sensible defaults:

- **base branch** — target base for the PR (default: repo default branch).
- **title hint** — preferred PR title.
- **`draft`** — open the PR as a draft.
- **extra intent** — anything the user wants emphasized in the PR body.

If there is no meaningful argument, proceed with defaults.

## Step 3 — Dispatch ONE fresh git-master subagent

Spawn exactly one agent via the Agent tool:

- `subagent_type`: `oh-my-claudecode:git-master`
- `model`: `sonnet`
- `description`: `commit-push-pr`

Give it a prompt that contains the intent summary, any parsed overrides, and the
explicit contract below. Because the subagent starts fresh, **state the repo /
user conventions explicitly** — do not assume it inherits this conversation's
knowledge:

> You are handling a complete commit → push → PR flow end to end. Do all git/gh
> work yourself; return only a compact summary.
>
> Intent (what changed and why): «paste the Step-1 summary here»
> Overrides: «base/title/draft/extra intent, or "none"»
>
> Procedure:
> 1. Run `git status` and `git diff HEAD` **yourself** to understand the change.
>    If there is nothing to commit, stop and report "no changes".
> 2. Determine the current branch. If it is `main` / the default branch, create a
>    new descriptively-named branch first (e.g. `feat/...`, `fix/...`).
> 3. Stage the appropriate changes and create **one** commit. Detect the repo's
>    existing commit-message style from `git log`. Apply this repo's commit
>    trailer protocol when applicable: `Constraint:`, `Rejected:`, `Directive:`,
>    `Confidence:`, `Scope-risk:`, `Not-tested:`. **Do NOT include any
>    `Co-Authored-By` line** (user preference).
> 4. Push the branch to `origin` with upstream tracking.
> 5. Before creating a PR, check `gh pr view` for the branch — if a PR already
>    exists, return its URL instead of creating a duplicate. Otherwise create the
>    PR with `gh pr create`, writing a title and a body that explains **what and
>    why** using the intent above (add a short test-plan line if known). Honor
>    `draft` / base-branch overrides.
> 6. Return ONLY this compact summary — no diff, no raw command output. This
>    summary is your RETURN VALUE, so it must be the FINAL thing you emit (nothing
>    after it). End with a single machine-parseable sentinel line in exactly this
>    form so the caller can recover the result even if the rest of your message is
>    lost:
>    - branch name
>    - commit SHA (short)
>    - PR URL (or "existing: <url>")
>    - one-line description of the change
>    - final line: `CPR_RESULT: <branch> | <short-sha> | <pr-url-or-"none"> | <one-liner>`

## Step 4 — Confirm the outcome, then relay

**Do not trust the subagent's free-text return.** A subagent may complete the
entire flow correctly yet return something useless like `"Ready."` instead of the
contracted summary — and you cannot read its transcript to recover the details
(that would overflow your context). So **always** run a cheap outcome probe
yourself before reporting, regardless of what the subagent said:

```sh
git log -1 --format='%h  %s'                                    # commit landed?
git status -sb | head -1                                        # pushed? upstream set?
gh pr view --json url,number,state,title --jq '"#\(.number) [\(.state)] \(.title)\n\(.url)"'
```

This is a **cheap outcome check** (a few hundred bytes), NOT a re-fetch of the
diff. The distinction is the whole game:

- **Banned**: `git diff` / `git show` / dumping `git status` *content* — that
  re-pollutes the parent with the diff the skill exists to keep out.
- **Required**: the SHA + push state + PR URL above — tiny, and the only reliable
  source of truth when the subagent's return is unreliable.

Relay the verified result to the user: branch, commit SHA, PR URL, one-liner. If
the probe shows nothing committed / no PR (and the subagent reported "no changes"
or an error), surface that plainly instead.

If the subagent's return includes the `CPR_RESULT: …` sentinel line, it's a handy
one-line recap — but the git/gh probe above remains the **authoritative** source
of truth. Never report a sentinel value that the probe contradicts; trust the
probe.

Note: a background/async subagent's *captured* return is often a trailing no-op
(e.g. `(no action needed)`) rather than its real final message, so the
`CPR_RESULT` line may be missing from what the harness hands back even when the
subagent emitted it correctly. If the probe is ambiguous and you still need the
sentinel, recover it with a targeted grep of the subagent's transcript file (the
`output_file` path from the dispatch result) — a few bytes, NOT a diff re-fetch:

```sh
grep -o 'CPR_RESULT: [^"\\]*' <output_file> | tail -1
```

Still reconcile against the probe; on any conflict, the probe wins.

## When NOT to use this

If the change is tiny and you've *already* got the full diff in context from
doing the work, the subagent round-trip can cost more than it saves — a direct
commit is fine. `/cpr` pays off when the diff is large or not yet in your context.
