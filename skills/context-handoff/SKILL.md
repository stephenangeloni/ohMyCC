---
name: context-handoff
description: >-
  Generate a continuation prompt that captures the full resumable state of the current
  work — goal and constraints, decisions and their rationale, dead ends to avoid, file
  and commit pointers, artifacts, conventions, and the exact next action — so a fresh
  session (or a teammate, or a future you) can pick the work back up with nothing lost.
  Covers every active thread when a session holds more than one. The result is written to
  HANDOFF.MD at the repository root, whose final lines are a ready-to-paste resume prompt
  that is also copied to the clipboard (pbcopy) automatically. Use this whenever the user
  wants to hand off, checkpoint, or preserve context: phrases like "create a handoff",
  "hand this off", "write a continuation/resume prompt", "checkpoint this", "save where we
  are", "summarize the context for a fresh chat/session", "I'm running low on context",
  "before we compact", "pass the baton", "bootstrap a new session", or "/handoff". Strongly
  prefer this skill over a plain summary or /compact whenever the goal is to CONTINUE the
  work elsewhere rather than just recap what happened — a summary explains the past, a
  handoff enables the future.
---

# Context Handoff

Produce a **continuation prompt**: a single, paste-able block that lets a fresh context
resume this work as if it had been here the whole time. The reader is a capable agent (or
person) with **zero memory of this conversation** but full access to the files, repo, and
tools. Your job is to give them exactly what they need to take the *next* action correctly —
no more, no less.

A summary explains what happened; a handoff lets someone *continue* — capturing the
reasoning behind decisions (so they aren't silently reversed), the approaches already
**ruled out** (so they aren't retried from scratch), and the conventions that live only in
this conversation. A plain `/compact` or recap loses all of that.

The deliverable is a file: **`HANDOFF.MD` at the repository root**. Its final lines are a
fixed resume prompt, and that resume prompt is copied to the clipboard so the user can paste
it straight into a new session. See *Write the handoff* below.

## How to build it

**1. Check for supplied direction.** The dispatcher passes anything typed after the command
through as `$ARGUMENTS`. If that's non-empty (or the user appended an instruction in the same
message), treat it as a **directive layered on top of the default process below** — not as
just more context to summarize. Common forms and how to apply them:
- **Scope/focus** ("focus on the auth thread", "just the bug fix, skip the refactor") → narrow
  coverage to that thread; still mention the dropped thread(s) in one line so nothing vanishes
  silently.
- **Next-action override** ("next action should be X instead", "have the next session start
  with Y") → replace the auto-detected `## Next action` with the supplied one for that thread.
- **Emphasis** ("make sure to call out the flaky test", "flag the perf regression risk") →
  fold it into the relevant existing section rather than bolting on a new one.

If no direction was supplied, skip straight to step 2. If it was, add a one-line note (in the
title area or the Honesty note) that this handoff's scope/next-action was shaped by explicit
user direction — so the reader knows it reflects an ask, not pure inference from the
conversation.

**2. Reconstruct the whole arc — don't just look at recent messages.** Read from the top:
the *first* user message usually states the real goal and constraints. Then scan forward for
the load-bearing moments: decisions made, corrections the user gave you, hypotheses that were
tried and abandoned, and where things stand right now. The recent tail is only the resume
point, not the whole picture.

**3. Identify the threads.** Note whether the session is **one** body of work or **several**
distinct threads — each with its own goal and state (e.g. a feature plus an unrelated bug
found along the way, or a work task plus a tooling/meta task). Cover **every** active thread
that step 1 didn't explicitly ask you to drop; a thread you silently drop is a thread the
fresh agent won't know to resume. A thread that's fully finished with no follow-up can be a
one-line note rather than a full section.

**4. Gather the concrete anchors.** Pull the real pointers a fresh agent needs:
- Files created or changed, and the key files to *read first*. Use `git status` / `git log`
  / `git diff --stat` and your own edit history to get this right rather than from memory.
- Commits, branches, PRs, deploys, built artifacts (tables, datasets, generated files),
  external state.
- Existing project memory, handoff docs, or notes already on disk — point to them instead of
  re-explaining their contents.

**5. Separate durable from ephemeral.** If something is already written down (a file, a
commit, a doc, project memory), **point to it** — don't inline it. Spend the handoff's words
on what exists *only in this conversation*: the unrecorded decision, the half-finished
reasoning, the "we agreed to do X next." This keeps the handoff lean and honest about where
the source of truth lives.

   **Never restate standing rules, constraints, or conventions that already live in an
   auto-loaded instruction file** — `CLAUDE.md` or `AGENTS.md` at the user or repo level. A
   fresh session loads those automatically, so the reader already has them; repeating them
   burns words and buries the action at hand. Reference such a file by path only when a
   *specific* rule is load-bearing for the next action and easy to miss; otherwise leave it
   out entirely. (This is the standing rule applied by the self-check's leanness test below
   and by the conventions section in the template.)

**6. Assemble into the template below, run the self-check, then write it to `HANDOFF.MD`**
(see *Write the handoff*).

## Output template

There are two shapes. Pick by thread count from step 3.

**Single thread** — use the flat structure: the per-thread sections, then the shared sections.

**Multiple threads** — open with a one-line index of the threads, repeat the per-thread
sections under a heading for each, then put the shared sections **once** at the end so the
cross-cutting material (conventions, honesty) isn't duplicated.

Include the sections that carry weight; drop the empty ones (a quick fix may have no "dead
ends"; a research thread may have no "artifacts" yet). Order them so the reader is oriented
before they get detail.

### Per-thread sections (one set per thread)

````
## Goal
<What this thread is trying to achieve and why, in 1–3 sentences. Include hard constraints
and the definition of done. This is the destination; everything else is navigation.>

## Start by reading (in order)
- `path/or/url` — <what it covers / why read it>
<The minimal set of files/docs that orient the reader. Pointers, not contents.>

## Where we are now
<Current state in a few lines: what's done, what's in flight, the single most important fact
to hold onto. For anything claimed done, say how you know it — a passing test, a manual check,
an observed output — not just that it was attempted.>

## Decisions made (and why)
- **<decision>** — <the reasoning>; <consequence / what it rules in or out>.
<So the fresh agent extends these instead of re-litigating or reversing them.>

## Dead ends — do not re-explore
- **<approach tried>** — looked right because <…>; abandoned because <…>.
<The biggest time-saver in the whole handoff. Omit only if there genuinely were none.>

## Out of bounds
<Two distinct kinds — name which applies: (1) scope deliberately left untouched, so the reader
doesn't assume adjacent work is covered; (2) areas the reader must not touch right now — code
owned by someone else, a module mid-migration, anything that would conflict if edited. Omit
only if genuinely neither applies.>

## Next action
<The exact next concrete step — specific enough to start immediately. Exactly one per thread:
if several candidates exist, pick the single safest one and note the others were considered
rather than listing multiple as equally next. Name the last gate the work is stopped at, if
any — an approval, a choice, or a review pending on the user — so the reader knows whether to
start immediately or wait.>

## Artifacts
<Files created/changed, commits/branches/PRs, tables/datasets built, external state.
Pointers with one-line descriptions.>
````

### Shared sections (once, after all threads)

````
## How the user works / conventions
<Working agreements and environment muscle memory the fresh agent can't infer: tooling,
naming, commit/deploy habits, gotchas, things the user has corrected before, how they like to
be consulted. This is what a fresh agent most painfully lacks. Usually shared across threads —
note any convention that applies to only one. Capture only what step 5's standing-rule
exclusion doesn't already cover.>

## Honesty note
<Two things, both required: (1) what is unfinished, unverified, uncertain, or an open risk —
anything that might break or regress; (2) what the reader must NOT assume — the specific
wrong inference they're likely to make if this isn't spelled out. A fresh agent will trust
this prompt completely, so be explicit about both.>
````

For the multi-thread shape, wrap the whole thing with a title and index:

````
# Handoff — <session title spanning the threads>

## Threads
1. **<thread A>** — <one line: state + next action>
2. **<thread B>** — <one line>

---
# Thread 1 — <name>
<per-thread sections>

---
# Thread 2 — <name>
<per-thread sections>

---
<shared sections>
````

## The quality bar — the self-check

Before you write it, apply one test, **per thread**:

> **Could a capable agent, given ONLY this prompt plus the files it points to, take that
> thread's next action correctly — without asking what already happened, re-deciding something
> already settled, or re-attempting something already ruled out?**

If not, find the gap and fill it. Common misses: the *why* behind a decision, an unwritten
agreement, a convention that's second nature here, or a next step too vague to start.

Then check the opposite failure: is it **lean**? Reapply step 5's standing-rule exclusion —
nothing already captured in a linked file or auto-loaded `CLAUDE.md`/`AGENTS.md`, no generic
agent knowledge, no narration of the journey that doesn't change the next action. Length is
not the goal — resumability is.

## Write the handoff

The handoff is **always written to a file** — that file is the deliverable, not an optional
extra.

**1. Resolve the repository root.** Write to `HANDOFF.MD` at the top of the working tree:

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

The target path is `"$ROOT/HANDOFF.MD"`. Overwrite any existing `HANDOFF.MD` — it is a
single, always-current handoff, not an append log. (Note the literal filename `HANDOFF.MD`,
uppercase extension, as the user specified.)

**2. Write the full handoff** (everything you assembled from the template above) to that
path, and make the **last line of the file the resume prompt below**, verbatim, under a short
heading. Nothing comes after it — it must be the final content of the file:

````markdown
---

## ▶ Resume prompt — paste into a fresh session

Copy the line below (already on your clipboard) and paste it as the first message of a
brand-new session:

Read HANDOFF.MD in the repository root and resume the work it describes. Start with the files under "Start by reading", honor every entry under "Decisions made (and why)", "Dead ends — do not re-explore", and "Out of bounds", then carry out the "Next action". If multiple threads are listed, resume all of them. Treat HANDOFF.MD as the source of truth — do not re-litigate settled decisions, re-walk the dead ends, or touch what's out of bounds.
````

**3. Copy that same resume prompt to the clipboard** by reading it back from the file you
just wrote — this keeps the file and clipboard byte-identical with no retyped copy to drift.
macOS only, so no `pbcopy` availability check is needed:

```bash
tail -n 1 "$ROOT/HANDOFF.MD" | pbcopy
echo "Resume prompt copied to clipboard."
```

**4. Confirm in chat — briefly.** The file is the source of truth, so do **not** re-dump the
whole handoff into the conversation. Report only:
- the path written (`<repo-root>/HANDOFF.MD`),
- a one-line-per-thread index of what it covers,
- the resume prompt itself, and a note that it is already on the clipboard.

If `HANDOFF.MD` is tracked by git and the user does not want it committed, remind them to add
it to `.gitignore` — but don't edit `.gitignore` unless asked.

**5. Stop — do not begin the next action.** The handoff's job ends when it's written and
confirmed. Even if the documented next action is obvious and you could start on it immediately,
don't — the checkpoint only works if the next session (or the user, right now) is the one who
decides when to resume it.
