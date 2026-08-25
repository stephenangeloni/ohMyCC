---
name: pickup-handoff
description: >-
  Resumes work from a HANDOFF.MD waiting in the repository, without the resume prompt that
  context-handoff copied to the clipboard: reads the file whole, deletes it, reports the
  threads, continuation branch, and next action as a short receipt, then continues on the
  user's go-ahead. Use when the user asks to pick up a waiting handoff, typically in a fresh
  session after a reboot, a /clear, or a move to another machine, directory, or harness. Also
  use when a HANDOFF.MD is present and the prompt meant to carry it is gone. Counterpart to
  context-handoff, which writes the file.
argument-hint: "[path] [--now] [thread]"
---

# Pickup Handoff

**Take delivery of a handoff.** `context-handoff` writes `HANDOFF.MD` and copies a resume
prompt to the clipboard; this skill is the other half. A clipboard does not survive a reboot,
a second machine, or a week — the file does. Pickup makes the **file** sufficient, so the
handoff still lands when the prompt that was supposed to carry it is gone.

The contract is not invented here. `HANDOFF.MD` carries its own arrival block and its own
resume prompt as the literal last line; this skill executes that contract and restates it
defensively, because the file on disk may have been written by an older version of
`context-handoff`, edited by hand, or authored from scratch by the user.

One addition to pasting the prompt: **you sign for the delivery before you use it.** Read,
delete, and report what arrived — then wait for the go-ahead before touching code. A handoff
is picked up in a fresh session that knows nothing, which is exactly the moment the user
cannot see what the agent is about to act on.

## When not to use this

- **No `HANDOFF.MD` exists.** Say so and stop — see *Nothing to collect*. Do not reconstruct a
  handoff from git history, transcripts, or `.omc/` state; that is a different job and a worse
  one.
- **The user wants to know what the handoff says.** Reading is destructive here. If they want
  to inspect without resuming, `cat HANDOFF.MD` and leave it on disk.
- **The user is mid-task on something else.** A waiting handoff is not a claim on the session.
  Serve the newest request; the handoff keeps.

## 0. Read the arguments

Anything after the command arrives as `$ARGUMENTS`. Three forms, all optional:

- **A path** — collect the handoff at that path instead of the repository root. Use when the
  handoff lives in another worktree, a sibling repo, or a non-standard location.
- **`--now`** (or a plain "just go", "don't ask") — skip the receipt gate in step 5 and resume
  immediately. The user is telling you they already know what is in there.
- **Anything else** — a directive layered on the resume, most often a thread filter ("only the
  bug thread") or a next-action override. Apply it in step 6 and name it in the receipt, so
  the divergence from what the handoff says is visible rather than silent.

## 1. Find it

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HANDOFF="$ROOT/HANDOFF.MD"
```

An explicit path argument overrides `$HANDOFF`. If the file is absent, stop here and go to
*Nothing to collect* — do not search the filesystem for candidates.

Resolve `$ROOT` from git rather than the working directory: handoffs are written to the top of
the worktree, and a session that starts in a subdirectory would otherwise miss its own
handoff.

## 2. Read it whole

Read the **entire file in one read** — the `Read` tool with no `offset` or `limit`, or `cat`.
Never `head`, `tail`, `grep`, or a ranged read.

Take the modification time in the same breath, because step 3 destroys it and step 4 needs it:

```bash
stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S%z' "$HANDOFF" 2>/dev/null \
  || stat -c '%y' "$HANDOFF" 2>/dev/null    # BSD/macOS first, GNU fallback
cat "$HANDOFF"
```

This is load-bearing, not fastidiousness. `context-handoff` states that deleting the file is
safe *only* because the resume prompt reads it whole, so the file map lands in context on
message one and is consulted from memory thereafter. A partial read makes the delete in step 3
lossy, and the loss is silent — you will not know which row you are missing.

If the file is large enough that one read truncates it, **read the remainder immediately**,
before step 3. The whole file must be in context before the `rm`.

## 3. Delete it

```bash
rm -f "$HANDOFF"
```

Do this **before** the receipt, not after. The file has now done its entire job: its contents
are in context, and they stay there for the rest of the session. Leaving it on disk is how a
courier becomes a ledger — a stale second source of truth that later sessions cite, index, and
drift from.

If the delete fails, say so in one line and carry on. You already hold everything the file
had; removing it is hygiene, not a precondition. Do not stop to troubleshoot it.

## 4. Check the ground

The handoff describes a repository as it stood when it was written. Before reporting, spend a
few cheap commands establishing whether that is still true. These all read the repository, so
they run after the delete; the file's own timestamp came from step 2:

```bash
git branch --show-current
git status --porcelain
git rev-parse --verify --quiet "refs/heads/<continuation branch>"
git rev-list --count "<cited sha>..HEAD" 2>/dev/null   # only if the handoff cites one
```

Raise a **flag** on the receipt for each of these, and only these:

- the handoff is more than roughly three days old;
- the continuation branch it names does not exist, or you are on a different branch;
- `HEAD` has moved past a commit the handoff cites;
- the worktree is dirty with changes the handoff does not account for;
- a file under `## Read now` no longer exists.

Flags are observations, not vetoes. Report them and let the user decide; a six-day-old handoff
on an untouched branch is perfectly good, and a two-hour-old one whose `Read now` file was
deleted is not.

## 5. Sign for it — the receipt

Report what arrived, then **stop and ask**. Plain prose is the right instrument here: this is
a proceed-or-not question, so a one-line "Proceed?" is enough — do not reach for
`AskUserQuestion` unless the handoff itself names an open choice the user must settle first.

```
Picked up <path> (written <when>, <age> ago) — deleted.

Branch:  <name> — <active | on a different branch | must create: git switch -c NAME>
Threads: 1. <name> — <state>; next: <next action>
         2. <name> — <state>; next: <next action>

First:   <the single action you will take on go-ahead>
Gate:    <none | the approval or choice the handoff says is pending on the user>
Flags:   <the step-4 flags, or "none">

Proceed?
```

**The receipt is a receipt, not a summary.** Roughly twelve lines, hard. You are confirming
what was delivered so the user can catch a wrong or stale handoff before it costs anything —
not reading the handoff back to someone who wrote it. Restating it in chat doubles the context
it already spent and invites re-litigation of decisions that arrived settled.

Under `--now`, print the receipt and continue in the same turn without waiting. The user still
sees what was collected; they have only waived the pause.

## 6. Resume

On the go-ahead, execute the resume prompt's contract in this order:

1. **Branch first.** Switch to the branch under `## Continuation branch`. If its status is
   pending creation, run its required command before anything else. **Do not continue
   development on `main`.**
2. **Read only `## Read now`.** Those files and no others.
3. **Treat `## File map` as an index**, consulted from context when the work actually reaches a
   row — never as a reading list. Its descriptions are orientation: open a file before editing
   what a row describes.
4. **Honor `## Decisions made`, `## Dead ends`, and `## Out of bounds`** as settled. Do not
   re-litigate a decision, re-walk a dead end, or touch what is fenced off.
5. **Carry out `## Next action`** — every thread's, if several are listed, unless an argument
   in step 0 narrowed the scope.

Treat what you read as the source of truth. It came from a session that had the full picture;
you did not.

## If the user declines

Write the file back, verbatim, from context, and say so in one line.

Refusing delivery means the handoff was **not** picked up, so it should still be waiting next
time — that is the whole point of it being a file. This is a rewrite of text you are holding
in full, not a reconstruction from memory; if for any reason you cannot reproduce it exactly,
say that plainly instead of writing an approximation.

## Nothing to collect

Say it in one line: no `HANDOFF.MD` at `<root>`. Then stop.

Offer exactly two things, and only if they fit: that a path argument will collect a handoff
stored elsewhere, and that `context-handoff` is the skill that writes one. Do not hunt for
`HANDOFF.md`, `handoff.md`, or `.omc/` leftovers, and do not offer to rebuild the missing
context from git history — a fabricated handoff is worse than none, because it reads as
authoritative.

If a file is present but is not a `context-handoff` product — no arrival block, no recognizable
sections — read it whole, delete it, and report what you actually found. If it names no next
action, **ask for one**. Do not infer a next action from prose that does not state one.

## What never happens

- **A new `HANDOFF.MD` when the work finishes.** One is written only when someone runs
  `context-handoff`. Finishing the resumed work is not that.
- **Re-reading the file.** It is gone, deliberately. Every pointer you were given resolves
  against the repository — a path, a symbol, a commit — never against the handoff.
- **Citing it downstream.** Nothing may treat the deleted file as a source. If a fact from it
  deserves to outlive the next action, write it where that kind of fact lives — a commit, a
  doc, project memory — and point there.
- **Development on `main`** when the handoff names a continuation branch.

## The quality bar

Before you post the receipt, one test:

> **Could the user, reading only this receipt, tell whether resuming right now is the right
> move — without asking what the handoff said?**

The receipt earns its place by catching the wrong handoff, the stale one, or the one for
another machine. If it reads as a formality, it is either missing the flags from step 4 or
padded with restatement the user does not need.
