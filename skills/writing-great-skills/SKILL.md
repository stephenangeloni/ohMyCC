---
name: writing-great-skills
description: Quality rubric and named-failure-mode catalog for authoring, reviewing, or revising an OMC skill. Use when writing a new SKILL.md, hardening skillify or learner output, reviewing a skill draft, or deciding what belongs in SKILL.md versus a references/ file. Defines the two loads, context pointers, the information hierarchy, completion criteria, six failure modes, the leading-word technique, which frontmatter fields OMC actually parses, and a pre-ship checklist.
---

# Writing Great Skills — the OMC authoring bar

This is the **quality bar** every OMC skill must clear. It is the missing counterpart to
OMC's skill *generators* (`skillify` turns a workflow into a draft; `learner` extracts a
learned skill): they produce a skill, and this rubric says whether the skill is any good.
Use it while authoring, and again — in a **separate reviewer pass** — before shipping.

**The root virtue is _predictability_.** A skill is a **procedure**, not a document. Its job
is to make the agent take the same competent *process* every run — not produce the same
output — spending as few tokens as possible to do it. Every rule below serves that one end.
When two rules seem to conflict, choose the one that makes the next agent's behavior more
predictable.

The same levers govern any document an agent consumes: a `SKILL.md`, a `CLAUDE.md`, an
`AGENTS.md`, a `docs/shared/*.md` reached by a pointer. The packaging differs; the writing
does not.

## When to use

- Writing a new `skills/<name>/SKILL.md` from scratch.
- Reviewing or hardening a `skillify` / `learner` draft before it ships.
- Reviewing any skill PR — this is the reviewer's checklist.
- Editing `CLAUDE.md`, `AGENTS.md`, or a shared doc that agents load.
- Deciding what belongs in `SKILL.md` vs a `references/` file vs a linked doc.

## When not to use

- Writing ordinary prose, docs, or code comments — use `writing-clearly-and-concisely`.
- Cleaning up code slop (not skills) — use `ai-slop-cleaner`.
- You only need the invocation-governance policy — go straight to
  `docs/shared/workflow-gating.md` §9.

---

## The two loads

Every document, section, and pointer you add spends one of two budgets. Naming which one
you are spending is the first question in any authoring decision.

- **Context load** — the cost of always-loaded material on the agent's window: a skill
  description, a `CLAUDE.md` line, anything sitting in context every turn, spending tokens
  and attention whether or not it fires. OMC currently spends **~1.5k tokens per turn** on
  skill descriptions alone. That is the budget you are drawing down when you add a skill.
- **Cognitive load** — the cost on the human: which skills exist and when to reach for each.
  The human is the index. This is **not** a cost to minimise — it is the price of human
  agency. Spend it where human judgement matters (`/ralplan` before `/autopilot`), remove it
  where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's
own line. Material with no pointer at all rides entirely on cognitive load — the human must
remember it exists.

**The practical rule:** a skill the model must reach on its own pays context load forever.
A skill only ever fired by hand (`disable-model-invocation: true`) pays none. Pick
model-invocation only when the agent — or another skill via `Skill()` — must reach it
autonomously. Reuse is a reason to *extract* a skill, not a reason to make it model-invoked.

---

## Context pointers

A **context pointer** is a reference held in the agent's context that names some
out-of-context material and encodes the condition for reaching it. A skill's `description`
is one. A line in `CLAUDE.md` naming `docs/shared/workflow-gating.md` is the same object.

**The pointer's wording, not its target, decides when the agent reaches the material — and
how reliably.** A must-have target behind a weakly worded pointer is a *variance bug*: the
agent reaches it some runs and not others. Sharpen the wording first; inline the material
only if sharpening fails.

A pointer does two jobs — state what the material is, and list the **branches** that should
trigger reaching it (a branch is a distinct case the document handles, so different runs
take different paths through it). Every word of an always-loaded pointer costs on every
turn, so it earns harder pruning than the body:

- **Front-load the leading word** — the pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written
  twice. Collapse them.
- **Cut identity the body already carries.**

### Description discipline

**The description is the only thing native Claude Code reads to decide whether to use a
skill**, and it is the highest-cost pointer in the system: loaded into the system prompt at
all times, while the body loads only on activation. Write it like it costs something.

1. **Third person, declarative.** "Generates a continuation prompt…", not "I will generate…"
   or "Use me to…". It describes the skill, not a conversation.
2. **Front-load the leading word.** The first word or two should be the skill's core concept
   (`Quality rubric…`, `Commit, push, and open a PR…`), because triage reads left to right.
3. **State BOTH what it does AND when to use it.** Always include an explicit "Use when …"
   clause with the real trigger situations. A description that says what a skill *is* but not
   *when to reach for it* will not fire.
4. **One trigger per behavioral branch.** List the *distinct* situations, not synonyms for
   one situation. Padding a description with synonyms is failure mode #2 in the
   highest-cost location in the codebase.
5. **Never rely on a `triggers:` field.** For builtin skills (`skills/*/SKILL.md`) the
   `triggers:` frontmatter key is **dead — silently ignored** by the loader. It is read
   *only* for learner skills in `.omc/skills/`. **Fold trigger keywords into the
   `description` itself** ("Use when the user says `deslop`…"). Verified in code: see the
   comment in `src/features/builtin-skills/types.ts` and workflow-gating §9.

---

## The information hierarchy

A document is built from two content types — **steps** (the ordered actions the agent
performs) and **reference** (definitions, rules, facts consulted on demand) — that mix
freely: all steps (`cpr`), all reference (this skill), or both (`fleet-review`). The core
decision is where each piece sits on the **ladder**, ranked by how immediately the agent
needs it:

1. **In-file step** — the primary tier: what the agent does, in order.
2. **In-file reference** — consulted on demand. Often a legitimately flat peer-set
   (`fleet-review`'s fourteen review angles on one rung) — a fine arrangement, not a smell.
3. **Disclosed reference** — pushed into a separate file, reached by a pointer, loaded only
   when the pointer fires. Spans a sibling `references/*.md` through fully external docs
   (`docs/shared/workflow-gating.md`) that any skill can point at.

Push too little down and the top bloats; push too much and you hide material the agent
actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder. It is not primarily a token
optimisation — it is how the hierarchy is protected. **Branching is the cleanest disclosure
test: inline what every branch needs, push behind a pointer what only some branches reach.**
When a document has steps, in-file reference that should have been disclosed buries them and
turns attending to them into a coin-flip.

OMC auto-advertises disclosed files: any non-`SKILL.md` file in the skill directory is
surfaced at runtime as a "Skill Resources" section (`src/utils/skill-resources.ts`), so a
`references/` file is discoverable with **zero extra wiring**.

- `references/*.md` — deep reference material, tables, extended examples.
- `scripts/*` — runnable helpers the skill invokes rather than inlines.
- `assets/*` — templates and fixtures.

**Co-location** is the within-file companion: where the ladder decides *how far down* a piece
sits, co-location decides *what sits beside it* once there. Keep a concept's definition,
rules, and caveats under one heading rather than scattered, so reading one part brings its
neighbours with it. The test: the document should read like documentation written for the
agent. (Distinct from duplication — that repeats one meaning in two places; scattering
fragments one meaning across many.)

**Size budget:** keep `SKILL.md` under **~500 lines / ~5k tokens**. The body loads in full on
activation, so a bloated skill taxes every run of it.

---

## Steps and completion criteria

Every step ends on a **completion criterion** — the condition that tells the agent the work
is done. Two properties make it a lever:

**Clarity** — can the agent tell done from not-done? A vague bound ("understanding reached",
"the code looks correct") invites **premature completion**: ending the step before it is
genuinely done, attention slipping toward *being done*. The visible steps still ahead — the
**post-completion steps** — supply the pull; the criterion's clarity is the resistance.

Defend in this order:

1. **Sharpen the bound first** — local and cheap. "A tight loop that goes red, whose exact
   invocation and output you have already pasted" beats "you understand the bug."
2. Only if the bound is irreducibly fuzzy *and* you observe the rush, **hide the later steps
   by splitting the sequence** — and hiding only works across a **real context boundary**
   (a subagent dispatch, a handoff). An inline `Skill()` call leaves the later steps in
   context and clears nothing. This is why `cpr` dispatches a fresh `git-master` rather than
   calling a commit skill inline.

**Demand** — how much the criterion requires. "Every finding cross-checked against source"
forces thorough work where "review the diff" does not. Demand drives **legwork** — the
digging the agent does *within* the step, latent in the wording rather than written as its
own step. It is not step-bound: "every rule applied" binds a body of flat reference just as
"every step done" binds a sequence, which is how an all-reference skill still carries an
exhaustiveness bar.

The strongest criteria are both checkable and exhaustive.

---

## When to split

Splitting one document into two spends one of the two loads, so split only when the cut
earns it:

- **By sequence** — split a run of steps where the post-completion steps tempt the agent to
  rush the one in front of it. Keeping them out of view drives more legwork on the current
  task. Beware the reverse: merging two sequences exposes each step's later steps to what
  follows, inviting premature completion.
- **By invocation** — split off a model-invoked skill when it has a distinct leading word
  that should trigger it on its own, or when another skill must reach it via `Skill()`. You
  pay context load for a new always-loaded description, so that independent reach has to be
  worth it.
- **By sprawl** — see failure mode #4.

Shared reference that two *user-invoked* skills both need can live in neither: with
`disable-model-invocation: true`, neither can fire the other. Push it to a plain file
outside the skill system — `docs/shared/*.md` — that any skill can point at.

---

## Leading words

A **leading word** is a compact concept already living in the model's pretraining that the
agent thinks with while running the document (*firewall*, *boulder*, *tracer bullet*, *tight*
loop). Repeated as a token — never restated as a sentence — it accumulates a distributed
definition and anchors a whole region of behavior in the fewest possible tokens, by
recruiting priors the model already holds.

OMC examples:
- `cpr` → **"context firewall"**: the diff crosses into the subagent, only the summary
  crosses back. Once you hold "firewall", the whole skill follows.
- `ralph` → **"the boulder never stops"**: the persistence loop, in four words.
- `diagnose` → **"tight loop"** and **"red"**: a fuzzy gate ("do I understand the bug?")
  becomes a binary observable state (the loop goes red on this bug, or it doesn't).
- `context-handoff` → **"a summary explains the past; a handoff enables the future."**

It anchors twice. In the body, *execution*: the agent reaches for the same behavior every
time the word appears. In a pointer, *invocation*: when the same word lives in your prompts,
your skills, and your codebase, the agent links that shared language to the material and
reaches it more reliably.

**Coining your own works only if you define it clearly — and a made-up word recruits no
priors.** You pay in definition tokens what a pretrained word gives free. Reach for an
existing word first.

**Prescription:** pick exactly **one** leading word per skill. State it early, then reuse the
*same* word — not a rotating cast of near-synonyms (that is duplication in the body). If you
cannot name the concept in one phrase, the skill probably has more than one job (sprawl).

Hunt for passages that collapse into a leading word: a triad spelled out at three sites, a
pointer spending a sentence to gesture at one idea. "Fast, deterministic, low-overhead" →
*tight*. Assume every document you touch is carrying restatements that a leading word
retires — go find them.

---

## The six failure modes

Name the failure, then fix it. Each is shown with an OMC-concrete before → after.

### 1. Premature completion
The skill declares success before the work is verified — it trusts a claim instead of
evidence. OMC's sharpest instance: a dispatched subagent returns `"Ready."` or a trailing
no-op instead of its contracted result, and the skill relays that as success.

- **Before:** "Dispatch the `git-master` subagent and report the PR URL it returns."
- **After:** "Dispatch it, **then run a cheap outcome probe yourself** (`git log -1`,
  `gh pr view`) and report the *verified* result — never the subagent's free-text claim."
  (This is exactly why `cpr` Step 4 exists.)

**Test:** for every "done", ask *how does the skill know?* If the answer is "the model said
so", it is premature. The fix is usually a sharper completion criterion, not more prose.

### 2. Duplication
Two or more instructions that are the same behavioral branch wearing different words. The
cost is drift: an edit updates one copy and the other rots into a contradiction. It also
inflates a meaning's prominence on the ladder past its real rank.

- **Before:** a description that says "use for cleanup, use for deslop, use for anti-slop,
  use for tidying up" — four synonyms for **one** trigger.
- **After:** one trigger, canonical keywords folded in once.

**Rule:** keep each meaning in a **single source of truth** — one authoritative place, so
changing the behavior is a one-place edit. If you can delete a line and lose no behavior, it
was a duplicate.

### 3. Sediment
Instructions that were true once and silently accreted into staleness — a reference to a
removed feature, a count that drifted, a step for a tool that no longer exists. Sediment is
the default fate of any document without a pruning discipline, because adding feels safe and
removing feels risky.

- **Before:** a skill still routing through `swarm` (removed in #1131), or a hand-maintained
  skill list that forgot `clip-it` after the migration added it.
- **After:** delete the dead reference; where a fact is derivable, **point to the live
  source** instead of copying it (a copied number is future sediment).

**The environment is a source of truth too** — `package.json` scripts, config files, the
directory layout, `--help` output. A document that restates it is a **cache**: a copy of a
lookup, earning its load only when the lookup is expensive. Cache what the agent *cannot*
find by looking — the unwritten convention, the reason behind a choice, the gotcha no config
confesses. Leave one-file, one-command lookups to the environment, where they cannot go
stale.

**Test:** would this line still be true if someone changed the thing it describes and never
opened this file? If not, it will rot — link, don't copy.

### 4. Sprawl
One skill trying to be several — or simply too long, even when every line is live and
unique. Attention thins across the excess, every extra line is one more to keep relevant,
and the description can no longer state a single clear trigger.

- **Before:** a "do everything" skill that plans, executes, reviews, *and* cleans up.
- **After:** a bounded skill with an explicit fence — the way `ai-slop-cleaner` states
  "Do not silently expand a changed-file scope into broader cleanup." When you need the
  neighbor behavior, **hand off** to the neighbor skill; don't absorb it.

**Test:** can you write the description's "Use when …" as *one* trigger without "and also"?
If not, split the skill. The cure for length alone is the ladder: disclose reference behind
pointers, and split by branch or sequence so each path carries only what it needs.

### 5. No-op
A step that reads like work but changes nothing. OMC has literally shipped this: an async
subagent's *captured* return is often a trailing no-op (`(no action needed)`) rather than its
real final message — so a step that says "relay the agent's result" can relay nothing.

- **Before:** "Read the value the background agent returned and report it."
- **After:** "The captured return is often a trailing no-op; recover the real result by
  probing the artifact directly (git/gh) or grepping the transcript for the sentinel line."
  (See `cpr` Step 4.)

**Test:** delete the step. If nothing about the outcome changes, it was a no-op — cut the
whole sentence rather than trimming words from it.

The test is **model-relative, not reader-relative**: a no-op is an instruction the model
already obeys by default. Two people disagreeing about whether a line is a no-op are
disagreeing about the model's default, and they settle it **by running the document, not by
debate**. The test also grades leading words: a word too weak to beat the default (*be
thorough*, when the agent is already thorough-ish) is a no-op, and the fix is a stronger word
(*relentless*), not a different technique.

### 6. Negation
Steering by prohibition drags the forbidden behavior into context and makes it *more*
available, not less. *Don't think of an elephant*, and the elephant is all there is: the
negation is a weak modifier that the strongly-activated concept overruns, so the ban
half-reads as an instruction to do the thing.

- **Before:** "Never dump `git diff` into the parent context."
- **After:** "The subagent reads the diff in its own window and returns only
  `{branch, SHA, PR URL, one-liner}` — **never** dump `git diff` into the parent." (`cpr`
  pairs every ban with its positive path; that pairing is what makes it usable.)

**Rule:** prompt the **positive** — state the target behavior so the banned one is never
spoken. A prohibition earns its place only as a hard guardrail you cannot phrase positively,
and even then it goes *after* the positive target, never instead of it. If you cannot name
the positive path, you do not yet understand the instruction well enough to give it.

---

## Invocation control

Whether the model may auto-launch a skill is governed by `disable-model-invocation` — a full
policy already lives in **`docs/shared/workflow-gating.md` §9**. Do not restate it; the
load-bearing facts for an author are:

- `disable-model-invocation: true` blocks **both** the model's autonomous selection **and**
  programmatic `Skill("…")` calls. Only a literal human `/command` bypasses it.
- **Hard rule:** never flag a skill that another skill invokes via
  `Skill("oh-my-claudecode:<name>")` — the flag severs that pipeline. Flag heavyweight
  fan-out/loop orchestrators the model should not self-start; never flag gates/routers
  (`ralplan`), pipeline targets, or `Skill()` callees.
- `user-invocable` is **not** the same thing — it controls menu visibility only, not
  Skill-tool access. Don't conflate them.
- ⚠️ Whether `disable-model-invocation` applies to **plugin-namespaced** skills (OMC ships as
  a plugin) is **docs-silent and unverified** — it is a safe no-op if unsupported, but
  confirm empirically after a plugin reload before relying on it.

Run workflow-gating §9's four-question checklist before flagging any new skill.

---

## Which frontmatter fields OMC actually parses

Authors waste effort adding fields the loader ignores. On a `skills/*/SKILL.md`, the builtin
loader (`src/features/builtin-skills/skills.ts`, `loadSkillFromFile`) reads **only**: `name`,
`description`, `aliases`, `model`, `agent`, `argument-hint`, the pipeline set
(`pipeline` / `next-skill` / `next-skill-args` / `handoff` / `handoff-policy`), and
`omc-full-body`. Everything else is left unset.

**Silently ignored** (do NOT add them expecting an effect): `triggers` (dead — fold into
`description`), `level`, `mcpConfig`, `allowedTools`, `subtask`, `license`, `compatibility`,
`metadata`. They exist on the `BuiltinSkill` *type* but the file loader never fills them.

**Read by native Claude Code, not by OMC's loader:** `disable-model-invocation`,
`user-invocable`, `allowed-tools` — CC honors them directly, but OMC's loader is blind to them.

The per-field effects, "maps to" names, and source pointers live in one authoritative table:
`references/frontmatter-fields.md`. This section is the glance; that file is the detail.

---

## The authoring checklist

Run this before shipping — as a **separate reviewer pass**, never self-approving the pass
that wrote the skill.

- [ ] **Predictable:** does the skill make the agent take the same competent process every time?
- [ ] **Loads named:** you can say which budget each new section spends, and why it earns it.
- [ ] **Description:** third person, leading word front-loaded, states what **and** "Use when
      …", one trigger per branch, no synonym padding, no reliance on `triggers:`.
- [ ] **Pointers:** every pointer to disclosed material names the branches that trigger it.
- [ ] **Hierarchy:** what every branch needs is inline; what only some branches reach is
      behind a pointer. A concept's rules and caveats are co-located, not scattered.
- [ ] **Completion criteria:** every step's "done" is checkable without asking the model's
      opinion, and demanding enough to force the legwork.
- [ ] **Leading word:** exactly one concept, pretrained rather than coined where possible,
      named early, reused (not rotated) through the body.
- [ ] **Six failure modes:** no premature completion (claims are verified), no duplication, no
      sediment (dead refs / copied facts removed → linked; the environment left to answer its
      own lookups), no sprawl (one clear job), no no-ops (every step changes the outcome), no
      bare negations (every "don't" has a "do", stated first).
- [ ] **Size:** `SKILL.md` under ~500 lines / ~5k tokens; overflow pushed to `references/`.
- [ ] **Frontmatter:** only parsed fields present; no dead `triggers:`/`level:`/`mcpConfig:`.
- [ ] **Invocation:** `disable-model-invocation` decision matches workflow-gating §9 (never
      flag a `Skill()` callee or a gate/router).
- [ ] **Wired:** `.claude-plugin/plugin.json` skills array, a `commands/<name>.md` wrapper
      (must contain `skills/<name>/SKILL.md` and `$ARGUMENTS`), the `omc-reference` registry,
      `CLAUDE.md`'s skills list, and any count assertions in `src/__tests__/skills.test.ts`.
- [ ] **Verified:** YAML frontmatter parses, `plugin.json` stays valid JSON, `pnpm test`
      green (skill loads), `pnpm exec tsc --noEmit` clean if `src/` was touched.

---

## This skill's own design decision (recorded)

**`writing-great-skills` is intentionally model-invocable** (no `disable-model-invocation`).

- **Rationale:** its value is that authoring/review *auto-consults the bar* — which requires
  model-invocability. It is a lightweight **reference** skill, not a heavyweight fan-out/loop
  orchestrator (the category workflow-gating §9 flags), so it sits with `cpr`,
  `context-handoff`, and `omc-reference`, which all stay model-invocable. Flagging it would
  also foreclose `skillify`/`learner` ever calling it programmatically via `Skill()`.
- **Cost control:** the trigger cost is bounded by a tightly-scoped description ("Use when …
  authoring, reviewing, or revising a skill"), so it activates in the narrow authoring
  context rather than firing on every turn.
- **Divergence from the source (`mattpocock/skills`, `writing-for-agents`):** that reference
  makes its equivalent user-invoked to minimize context load. OMC diverges because it has
  skill *generators* that should reach the rubric programmatically — which requires
  model-invocability — and because a precise description keeps the context cost small enough
  to be worth paying.
