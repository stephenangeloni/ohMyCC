---
name: mpcw
description: Merge a worktree feature branch into main, push, and clean up the worktree (removes the worktree + deletes the branch local and remote). Runs inline in the parent — interactive, NOT dispatched to a subagent.
---

# /mpcw — Merge, Push, Clean — Worktree edition

Worktree-aware version of `/mpc`. Run from the MAIN worktree on `main`. Discovers feature worktrees, asks the user which one to merge, then merges + pushes + removes the worktree + deletes the branch both locally and remotely.

Like `/mpc`, this runs inline in the parent (it needs an `AskUserQuestion` gate to pick the worktree and performs destructive merge/worktree-removal), so it is deliberately NOT dispatched to a git-master subagent.

## When to use this vs `/mpc`

- `/mpc` — run from a feature branch in a single-worktree repo. Checks out main, merges, cleans up.
- `/mpcw` — run from `main` in the PRIMARY worktree, when there are one or more `git worktree add`-created feature worktrees to merge and tear down.

Trying to run `/mpc` from a worktree setup fails with `fatal: 'main' is already used by worktree at ...`. That's the signal to use `/mpcw` instead.

## Prerequisites

- Must be on `main` (or `master`) in the primary worktree.
- At least one additional worktree exists (`git worktree list` shows more than one entry).
- Working tree of main is clean.

## Steps

### 1. Sanity checks

- `git rev-parse --abbrev-ref HEAD` — must be `main` or `master`. If not, abort with: "Run this from the primary worktree on main. You're on <branch>."
- `git status --porcelain` — must be empty. If dirty, abort with: "Main has uncommitted changes; commit or stash before running /mpcw."

### 2. Discover candidate worktrees

- Run `git worktree list --porcelain` and parse it. Each worktree block contains `worktree <path>`, `HEAD <sha>`, and either `branch refs/heads/<name>` or `detached`.
- Exclude the primary worktree (the one whose branch matches current HEAD).
- Exclude any detached-HEAD worktrees (nothing to merge).
- For each remaining worktree, check if its branch has commits ahead of `origin/main` (or `main`): `git rev-list --count main..<branch>`. If the count is 0, the branch has nothing to merge — include it in the list but flag it as "nothing new to merge (delete only)".

If no candidates remain at all, report "No mergeable worktrees found" and exit.

### 3. Ask the user which to merge

Use the AskUserQuestion tool with one question: "Which worktree/branch do you want to merge and clean up?"

Options: one per candidate worktree. Label format: `<branch>` with description `<N> commits ahead of main, worktree at <path>`. If N=0, label it `<branch>` with description `no commits to merge (delete only), worktree at <path>`.

If there are more than 4 candidates, prefer the ones with commits ahead first; user can rerun for more.

### 4. Fast-forward main (safety)

- `git pull --ff-only`
- If it fails (main diverged from origin), abort with the specific error.

### 5. Merge the chosen branch

- `git merge <branch>`
- If merge fails due to conflicts, stop and report the conflicting files, then offer the user
  a choice: resolve manually and rerun, or have you work through it using the resolution
  procedure in `/mpc` ("Resolving merge conflicts") — resolve by intent traced to each side's
  primary source, run the project's checks, then continue from step 6. Never force, and never
  `--abort` on the user's behalf.
- If the branch had 0 new commits, skip merge (nothing to do).

### 6. Push main

- `git push`

### 7. Remove the worktree

- Capture the worktree path from step 2.
- `git worktree remove <path>`
- If `git worktree remove` refuses because the worktree has untracked files or local changes, report clearly. Offer the user the option to rerun with `git worktree remove --force <path>` but DO NOT use `--force` without explicit re-confirmation.

### 8. Delete local and remote branch (in parallel)

- `git branch -d <branch>` (lowercase — safe delete; refuses if not merged)
- `git push origin --delete <branch>`

Run these two in parallel.

### 9. Report final state

Print a concise summary with these exact elements:

- Merged commit (first line of `git log -1 --oneline`)
- Branch name that was cleaned
- Worktree path that was removed
- Final line: "**Worktree at `<path>` is gone. You can close the directory and superset tab for that worktree now.**"

## Rules

- Never use `git branch -D` (capital D force-delete) without explicit user permission.
- Never use `git worktree remove --force` without explicit user permission.
- Never skip the `git pull --ff-only` step — main must be current before the merge.
- If multiple worktrees exist, ask once per invocation; don't batch-delete unless the user explicitly asks.
- If the user is on a feature branch (not main), delegate to `/mpc` instead.
- If `git worktree list` shows only one worktree, there's nothing for this skill to do — suggest `/mpc` or abort.

## Safety nets

This skill pushes to `main`. Per user-level preferences, always warn the user before the push step if the branch had significant divergence (e.g., > 20 commits to be merged). A typical feature-branch merge is fine without extra confirmation.
