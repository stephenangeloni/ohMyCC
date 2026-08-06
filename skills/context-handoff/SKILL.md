---
name: context-handoff
description: >-
  Continuation prompt carrying the full resumable state — goals, constraints, decisions and
  rationale, dead ends, file and commit pointers, every active thread, and the exact next
  action — written to HANDOFF.MD and copied to the clipboard. Use when the work must travel:
  to a new session, harness, directory, or person. Also use when the user is running low on
  context and wants continuation rather than a recap.
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
it straight into a new session. The handoff also preserves a context-matching branch so the
next session does not resume development on `main`. See *Write the handoff* below.

## First: is a handoff the right move?

A handoff is **narrow**. What it buys is **portability** — a file that travels. If nothing is
travelling, something cheaper is correct. Make this call at a **phase boundary** (the gap
between two chunks of work — the planning, the implementation, the QA), never mid-phase;
mid-phase there is no decision to make except continue or split the remainder into subagents.

Work the tree top to bottom. **The first yes wins.**

1. **Can you continue in this session?** Yes if the next phase needs this one as a *primary
   source* (planning → implementation wants the reasoning verbatim, not a summary of it), or
   you simply have enough window left. **Continue costs nothing and loses nothing** — rule it
   out before anything else.
2. **Is this context irrelevant to what comes next?** If the exploration, the decisions, and
   the dead ends are all disposable — **`/clear`**. Cheapest move available. But the cost of
   getting it wrong is one-way: clear a *relevant* context and the **why** behind what you
   built is gone, and no amount of reading the diff back returns it.
3. **Does the work need to travel?** Only then is this skill correct — a new harness
   (Claude → Codex), a new directory or repo, a colleague, or forking a side task you found
   mid-phase without derailing the current one. That list is the whole clause.
4. **Can the remaining task run AFK?** Scoped tightly enough to run unattended with no
   steering — send it to a **subagent** and leave this session untouched.
5. **Otherwise `/compact`,** with an instruction (`/compact we're about to QA the auth path`)
   so the summary keeps what the next phase needs.

`/compact` sits at the **bottom** deliberately: it is the default, not the first reach. Every
move except *Continue* turns a **primary source** — the session as it happened — into a
**secondary source**, a lossy summary of it. You gain room and lose fidelity; only pay that
when staying costs more than it saves. The failure mode of reaching for `/compact` first is a
fresh session that is confidently wrong about a decision the summary flattened.

These are judgement calls, and the same boundary can go two ways on two days. The value is in
asking the questions **in order**. If the answer lands on 1, 2, 4, or 5, say so in one line
and stop — don't write a handoff nobody will read.

## How to build it

**Branch preflight (before step 1; skip only outside a Git repository).** Resolve the
repository root and inspect the current branch before assembling the handoff:

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
BRANCH="$(git branch --show-current)"
```

- If `BRANCH` is not `main`, stay on that branch and record it as the continuation branch.
- If `BRANCH` is `main`, derive a concise, context-matching branch name from the active goal.
  Follow the repository's existing branch convention when one is evident; otherwise use a
  conventional type such as `feat/`, `fix/`, `docs/`, or `chore/` plus a kebab-case context
  slug. Create and switch to it immediately with `git switch -c <branch>`. A new local branch
  is reversible, so do not pause for permission solely to create it.
- Never reuse an unrelated existing branch just because its name collides. Choose another
  descriptive name instead.
- If branch creation or switching cannot be completed safely, record the exact requested
  branch name and `git switch -c <branch>` command in `## Continuation branch`, mark it
  pending, and make that command the blocking first action on resume. The fresh context
  **must not continue development on `main`**.

This preflight is part of starting the handoff, not part of the later development work. Do
not move an existing non-`main` session to a different branch.

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
- Files created or changed. Use `git status` / `git log` / `git diff --stat` and your own edit
  history to get this right rather than from memory.
- **Sort every file pointer into one of two buckets** — this drives the two file sections in
  the template:
  - **Required for the next action**: the reader cannot take that step correctly without
    having read it. Almost always very few files.
  - **Contingent**: relevant only *if* the work goes a certain direction. Everything else
    lands here, including files central to the work but not to the next step.
- Commits, branches, PRs, deploys, built artifacts (tables, datasets, generated files),
  external state.
- Existing project memory, handoff docs, or notes already on disk — point to them instead of
  re-explaining their contents.

   **Anchor on names, not line numbers.** Point at a function, symbol, heading, or frontmatter
   key — something greppable that survives the next edit. Line numbers go stale on the first
   commit after the handoff and will send the reader to the wrong place.

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

## Read now (required for the next action)
- `path/or/url` — <why the next action cannot be taken correctly without this>
<Hard cap: at most three entries, and often zero or one. A file belongs here ONLY if the
reader would have to open it anyway to take THE next action. Everything else — including
files central to the thread but not to that step — goes in the file map below. Pointers,
not contents.>

## File map — read on demand
| If you need to… | Go to | What you'll find |
|---|---|---|
| <the question or task that would send the reader here> | `path` → `<symbol / heading>` | <what's there, and the non-obvious part> |
<An index, not a reading list. The reader consults a row when the work reaches it and
otherwise never opens the file. Key the left column on the reader's *intent* — the question
they'll have — not on a description of the file; a row keyed "hook dispatch logic" can't be
triaged without opening the file, while "change when a hook fires" can. Include the gotcha in
the third column: what surprised us in that file is the part worth writing down.>

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
Pointers with one-line descriptions. This is the ledger of what this session *changed*; the
file map above is the index of where to *go*. A path can appear in both, but don't repeat the
explanation — here say what changed about it, there say when to open it.>
````

### Shared sections (once, after all threads)

````
## Continuation branch
- Branch: `<context-matching branch>`
- Status: `<active and created | already active | pending creation>`
- Required command: `<none | git switch -c <branch>>`
<This section is required in a Git repository. If creation is pending, state explicitly that
the reader must run the command before any development and must not continue on `main`.>

## How the user works / conventions
<Working agreements and environment muscle memory the fresh agent can't infer: tooling,
naming, commit/deploy habits, gotchas, things the user has corrected before, how they like to
be consulted. This is what a fresh agent most painfully lacks. Usually shared across threads —
note any convention that applies to only one. Capture only what step 5's standing-rule
exclusion doesn't already cover.>

## Honesty note
<Three things, all required: (1) what is unfinished, unverified, uncertain, or an open risk —
anything that might break or regress; (2) what the reader must NOT assume — the specific
wrong inference they're likely to make if this isn't spelled out; (3) that the file map's
descriptions are orientation, not a substitute for the file — before editing anything the map
points at, open it. A fresh agent will trust this prompt completely, so be explicit about all
three.>
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
> already settled, re-attempting something already ruled out, or developing on `main`?**

If not, find the gap and fill it. Common misses: the *why* behind a decision, an unwritten
agreement, a convention that's second nature here, or a next step too vague to start.

Then check the opposite failure: is it **lean**? Reapply step 5's standing-rule exclusion —
nothing already captured in a linked file or auto-loaded `CLAUDE.md`/`AGENTS.md`, no generic
agent knowledge, no narration of the journey that doesn't change the next action. Length is
not the goal — resumability is.

Finally, check the **reading budget** — the handoff spends the fresh session's context before
it has done any work, so the split matters:
- Is `## Read now` at or under three entries? If not, the overflow is contingent, not
  required — move it to the file map.
- Justify each remaining entry out loud: *"the next action is X, and X cannot be done
  correctly without this file."* If that sentence doesn't hold, the file moves down.
- Is `## Read now` empty while the next action edits code? Then it's under-specified, not
  lean — name the file being edited.
- Does every file-map row read as a *question the reader might have*, rather than a label for
  the file? A row the reader can't triage without opening the file has failed its only job.

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

Read HANDOFF.MD in the repository root and resume the work it describes. Before making changes, switch to the branch under "Continuation branch"; if its status is pending creation, run its required command first and do not continue development on main. Read the files under "Read now" and only those; treat "File map" as an index to consult when the work actually reaches a row, not as a reading list, and open a file before editing what a row describes. Honor every entry under "Decisions made (and why)", "Dead ends — do not re-explore", and "Out of bounds", then carry out the "Next action". If multiple threads are listed, resume all of them. Treat HANDOFF.MD as the source of truth — do not re-litigate settled decisions, re-walk the dead ends, or touch what's out of bounds.
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
- the continuation branch and whether it is active or pending creation,
- a one-line-per-thread index of what it covers,
- the resume prompt itself, and a note that it is already on the clipboard.

If `HANDOFF.MD` is tracked by git and the user does not want it committed, remind them to add
it to `.gitignore` — but don't edit `.gitignore` unless asked.

**5. Stop — do not begin the next action.** The handoff's job ends when it's written and
confirmed. Even if the documented next action is obvious and you could start on it immediately,
don't — the checkpoint only works if the next session (or the user, right now) is the one who
decides when to resume it.
