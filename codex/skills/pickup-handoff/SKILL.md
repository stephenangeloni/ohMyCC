---
name: pickup-handoff
description: "Take delivery of a waiting handoff file and resume the work it describes."
---

# Pickup Handoff

Take delivery of a handoff that `context-handoff` left on disk, so the file alone is enough to resume when the copied resume prompt is gone. Resolve the repository root with `git rev-parse --show-toplevel` and look for `HANDOFF.MD` there; an explicit path argument overrides that location. If no such file exists, say so in one line and stop. Do not search the filesystem for candidates and do not rebuild the missing context from git history, because a fabricated handoff reads as authoritative.

Read the entire file in one read. Never use a ranged read, `head`, `tail`, or `grep`: deleting the handoff is safe only because the whole file, including its on-demand file map, lands in context up front, and a partial read makes that deletion silently lossy. If one read truncates the file, read the remainder before deleting anything.

Delete the file with `rm -f` immediately after reading and before reporting. Its contents now live in the conversation, and leaving it on disk is how a single-use courier becomes a stale second source of truth. If the delete fails, note it in one line and continue, because you already hold everything the file carried.

Capture the file's modification time in the same command that reads it, since deletion destroys it. Then establish whether the repository still matches what the handoff describes: the current branch, whether the named continuation branch exists, whether the worktree is dirty, whether HEAD has moved past any commit the handoff cites, and whether the files it marks as required reading still exist. Report each mismatch as a flag. Flags are observations for the user to weigh, not vetoes.

Report what arrived as a short receipt of roughly twelve lines: path and age, continuation branch and its status, one line per thread with its state and next action, the single action you will take first, any approval the handoff says is still pending on the user, and the flags. Then stop and ask whether to proceed. The receipt confirms delivery so the user can catch a wrong or stale handoff before it costs anything; it is not a summary, and restating the handoff in full doubles the context it already spent and invites re-litigation of decisions that arrived settled. Skip the pause only when the user explicitly asks to resume immediately.

On the go-ahead, switch to the continuation branch first, running its creation command when the handoff marks it pending, and never continue development on `main`. Read only the files the handoff marks as required for the next action. Treat its file map as an index consulted when the work reaches a row, not as a reading list, and open a file before editing what a row describes. Honor its recorded decisions, dead ends, and out-of-bounds areas as settled, then carry out the next action for every thread listed unless the user narrowed the scope.

If the user declines, write the file back verbatim from context and say so, because a refused delivery was never picked up and should still be waiting next time. Never write a new handoff when the resumed work finishes, never treat the deleted file as a citable source, and resolve every pointer against the repository rather than against the handoff.
