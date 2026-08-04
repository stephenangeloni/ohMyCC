---
name: context-handoff
description: "Create a concise durable handoff for another Codex context."
---

# Context Handoff

At the start, resolve the repository and run `git branch --show-current`. If the current branch is not `main`, keep it as the continuation branch. If it is `main`, derive a concise, context-matching branch name from the active goal, follow existing repository naming conventions when available, and create and switch to the local branch with `git switch -c <branch>`. Local branch creation is reversible, so do not pause for permission solely to create it. Never reuse an unrelated colliding branch.

If branch creation cannot be completed safely, record the exact requested branch and command, make `git switch -c <branch>` the blocking first resume action, and state that the fresh context must not continue development on `main`. Do not move an existing non-`main` session to another branch.

Capture the goal, constraints, completed work, changed files, verification evidence, unresolved risks, continuation-branch status, and exact next command. Keep facts separate from inference and omit secrets. Store the handoff only when requested; otherwise return it directly.

Split file pointers in two so the fresh context reads only what it needs when it needs it. List at most three files the next action cannot be taken correctly without, and put everything else in an on-demand map whose rows are keyed by the reader's intent ("if you need to change X, go to Y") rather than by a description of the file. Anchor on symbol, function, or heading names instead of line numbers, which go stale on the next commit. State that map descriptions are orientation only and the file must be opened before editing it.
