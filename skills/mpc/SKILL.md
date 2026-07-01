---
name: mpc
description: Merge the current feature branch into main, push, and delete the branch (local + remote). Runs inline in the parent — interactive and safety-gated, NOT dispatched to a subagent.
---

# /mpc — Merge, Push, Clean

Merge the current feature branch into main, push, and delete the branch.

**Why this runs inline (not via a git-master subagent like `/cpr`):** `/mpc` has
interactive `AskUserQuestion` gates (untracked files, commit message) that a
subagent cannot present to the user, and it performs a destructive merge-to-main
where the parent's step-by-step visibility and outcome checks matter. It also has
no large-diff problem to firewall — a fast-forward/merge emits only a diffstat.
So `/mpc` is deliberately the inline sibling of `/cpr`, not a subagent dispatch.

## Prerequisites

- You must be on a feature branch (not main/master)
- The branch must have a remote tracking branch

## Steps

1. Capture the current branch name
2. **Commit any pending work first** (see "Pending changes" below). If the working
   tree is clean, skip to step 3.
3. `git checkout main && git merge <branch>`
4. `git push` (push main to remote)
5. `git branch -d <branch>` (delete local branch)
6. `git push origin --delete <branch>` (delete remote branch)

## Pending changes (step 2)

Before merging, ensure the feature branch's working tree is clean. Otherwise the
merge proceeds without the user's WIP and that work appears stranded once the
branch is deleted in steps 5–6.

```bash
# Detect any pending work — modified tracked files, staged changes, or untracked.
git status --porcelain
```

If `git status --porcelain` is empty, the tree is clean — proceed to step 3.

If non-empty:

1. **Show the user what's pending.** Run `git status` and `git diff --stat HEAD`
   so they can see modified files and rough size; print the untracked list too.
2. **Stage tracked changes only by default.** Use `git add -u` (stages
   modifications and deletions to already-tracked files). Do NOT run
   `git add -A` or `git add .` — those sweep in untracked files and risk
   committing `.env`, credential files, large binaries, or scratch artifacts.
3. **Decide what to do with untracked files** via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Working tree has untracked files: <list, max ~10 names>. Include them in the pre-merge commit?",
    header: "Untracked files",
    multiSelect: false,
    options: [
      { label: "Include all",           description: "git add <each listed file>; they land in the commit alongside tracked changes" },
      { label: "Include some",          description: "You name specific paths to add; the rest stay untracked" },
      { label: "Skip — tracked only",   description: "Commit modified tracked files only; untracked files remain in the working tree (will be lost if you later switch branches and they conflict)" },
      { label: "Cancel /mpc",           description: "Don't commit, don't merge — let me sort out the working tree manually" }
    ]
  }]
})
```

4. **Propose a commit message and confirm.** Read recent history with
   `git log --oneline -10` to match the project's style (e.g. `feat(scope): …`,
   `fix: …`, `docs: …`), draft a one-line subject describing the staged changes,
   then ask the user via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Pre-merge commit message:\n\n  <proposed subject line>\n\nUse this, edit, or skip?",
    header: "Commit message",
    multiSelect: false,
    options: [
      { label: "Use as-is",       description: "Commit with the proposed subject" },
      { label: "Let me edit",     description: "You provide a replacement message in your next turn" },
      { label: "Cancel /mpc",     description: "Don't commit; abort the merge-push-clean flow" }
    ]
  }]
})
```

5. **Commit.** Per the user's global CLAUDE.md, do NOT add a `Co-Authored-By`
   trailer. Use a HEREDOC for multi-line messages:

```bash
git commit -m "$(cat <<'EOF'
<subject line>

<optional body>
EOF
)"
```

6. **Verify clean tree.** Run `git status --porcelain` again; it should be empty
   (modulo any untracked files the user explicitly chose to skip). Then proceed
   to step 3 of the main flow.

If a pre-commit hook fails: do not retry with `--no-verify`. Fix the underlying
issue, re-stage, and create a new commit (never `--amend`, since the failed
commit didn't land).

## Rules

- If already on main, abort and tell the user
- If the working tree is dirty, run step 2 (Pending changes) before touching main
- Never use `git add -A` / `git add .` — sweep risk for secrets and binaries
- Never use `--no-verify` to bypass a failed pre-commit hook
- If merge has conflicts, stop and report — do not force
- Run steps 5 and 6 (local + remote branch delete) in parallel
- Report the final state concisely: pre-merge commit (if any), merged commit, branch cleaned
- Worktree setup? If `git checkout main` fails with `'main' is already used by worktree at ...`, stop and use `/mpcw` instead.
