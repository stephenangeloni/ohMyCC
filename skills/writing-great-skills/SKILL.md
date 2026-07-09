---
name: writing-great-skills
description: Quality rubric and named-failure-mode catalog for authoring, reviewing, or revising an OMC skill. Use when writing a new SKILL.md, hardening skillify or learner output, reviewing a skill draft, or deciding what belongs in SKILL.md versus a references/ file. Defines the description-writing standard, six failure modes (premature completion, duplication, sediment, sprawl, no-op, negation), the leading-word technique, which frontmatter fields OMC actually parses, and a pre-ship checklist.
---

# Writing Great Skills — the OMC authoring bar

This is the **quality bar** every OMC skill must clear. It is the missing counterpart to
OMC's skill *generators* (`skillify` turns a workflow into a draft; `learner` extracts a
learned skill): they produce a skill, and this rubric says whether the skill is any good.
Use it while authoring, and again — in a **separate reviewer pass** — before shipping.

**The root virtue is _predictability_.** A skill is a **procedure**, not a document. Its job
is to make the agent behave the *same competent way every time* a situation recurs, spending
as few tokens as possible to do it. Every rule below serves that one end. When two rules
seem to conflict, choose the one that makes the next agent's behavior more predictable.

## When to use

- Writing a new `skills/<name>/SKILL.md` from scratch.
- Reviewing or hardening a `skillify` / `learner` draft before it ships.
- Reviewing any skill PR — this is the reviewer's checklist.
- Deciding what belongs in `SKILL.md` vs a `references/` file vs a linked doc.

## When not to use

- Writing ordinary prose, docs, or code comments — use `writing-clearly-and-concisely`.
- Cleaning up code slop (not skills) — use `ai-slop-cleaner`.
- You only need the invocation-governance policy — go straight to
  `docs/shared/workflow-gating.md` §9.

---

## The six failure modes

Name the failure, then fix it. The first five are the classic skill-rot modes; the sixth
(**negation**) is the one OMC hits most. Each is shown with an OMC-concrete before → after.

### 1. Premature completion
The skill declares success before the work is verified — it trusts a claim instead of
evidence. OMC's sharpest instance: a dispatched subagent returns `"Ready."` or `"done"`
instead of its contracted result, and the skill relays that as success.

- **Before:** "Dispatch the `git-master` subagent and report the PR URL it returns."
- **After:** "Dispatch it, **then run a cheap outcome probe yourself** (`git log -1`,
  `gh pr view`) and report the *verified* result — never the subagent's free-text claim."
  (This is exactly why `cpr` Step 4 exists.)

**Test:** for every "done", ask *how does the skill know?* If the answer is "the model said
so", it is premature.

### 2. Duplication
Two or more instructions that are the same behavioral branch wearing different words. The
cost is drift: an edit updates one copy and the other rots into a contradiction.

- **Before:** a description that says "use for cleanup, use for deslop, use for anti-slop,
  use for tidying up" — four synonyms for **one** trigger.
- **After:** one trigger, with the canonical keywords folded in once:
  "Clean AI-generated code slop… Use when the user says `deslop`, `anti-slop`, or `AI slop`."

**Rule:** one instruction per behavioral branch. If you can delete a line and lose no
behavior, it was a duplicate.

### 3. Sediment
Instructions that were true once and silently accreted into staleness — a reference to a
removed feature, a count that drifted, a step for a tool that no longer exists.

- **Before:** a skill still routing through `swarm` (removed in #1131), or a hand-maintained
  skill list that forgot `clip-it` after the migration added it.
- **After:** delete the dead reference; where a fact is derivable, **point to the live
  source** instead of copying it (a copied number is future sediment).

**Test:** would this line still be true if someone changed the thing it describes and never
opened this file? If not, it will rot — link, don't copy.

### 4. Sprawl
One skill trying to be several. It grows past the point where the agent can hold its whole
procedure in view, and its description can no longer state a single clear trigger.

- **Before:** a "do everything" skill that plans, executes, reviews, *and* cleans up.
- **After:** a bounded skill with an explicit fence — the way `ai-slop-cleaner` states
  "Do not silently expand a changed-file scope into broader cleanup." When you need the
  neighbor behavior, **hand off** to the neighbor skill; don't absorb it.

**Test:** can you write the description's "Use when …" as *one* trigger without "and also"?
If not, split the skill.

### 5. No-op
A step that reads like work but changes nothing. OMC has literally shipped this: an async
subagent's *captured* return is often a trailing no-op (`(no action needed)`) rather than
its real final message — so a step that says "relay the agent's result" can relay nothing.

- **Before:** "Read the value the background agent returned and report it."
- **After:** "The captured return is often a trailing no-op; recover the real result by
  probing the artifact directly (git/gh) or grepping the transcript for the sentinel line."
  (See `cpr` Step 4, which recovers the real result this way instead of trusting the return.)

**Test:** delete the step. If nothing about the outcome changes, it was a no-op — cut it or
make it do something.

### 6. Negation
Telling the model what **not** to do without giving it the positive path to take instead. A
bare prohibition leaves the agent to improvise the alternative — the opposite of
predictable. Negation is fine *only* when paired with the "do this instead."

- **Before:** "Never dump `git diff` into the parent context."
- **After:** "Never dump `git diff` into the parent — **instead**, the subagent reads the
  diff in its own window and returns only `{branch, SHA, PR URL, one-liner}`." (`cpr` pairs
  every ban with its positive path; that pairing is what makes it usable.)

**Rule:** every "don't" gets a paired "do". If you can't name the positive path, you don't
yet understand the instruction well enough to give it.

---

## Description discipline

**The description is the only thing native Claude Code reads to decide whether to use a
skill.** Claude Code loads every skill's `name` + `description` into the system prompt at
all times; the **body loads only on activation**. So the description is not a summary — it
is the skill's entire discovery surface, and it is spent on every turn. Write it like it
costs something, because it does.

Five rules:

1. **Third person, declarative.** "Generates a continuation prompt…", not "I will generate…"
   or "Use me to…". It describes the skill, not a conversation.
2. **Front-load the leading word.** The first word or two should be the skill's core concept
   (`Quality rubric…`, `Commit, push, and open a PR…`), because triage reads left to right.
3. **State BOTH what it does AND when to use it.** Always include an explicit "Use when …"
   clause with the real trigger situations. A description that says what a skill *is* but not
   *when to reach for it* will not fire.
4. **One trigger per behavioral branch.** List the *distinct* situations, not synonyms for
   one situation. Collapsing synonyms is failure mode #2; padding the description with them
   is the same rot in the highest-cost location.
5. **Never rely on a `triggers:` field.** For builtin skills (`skills/*/SKILL.md`) the
   `triggers:` frontmatter key is **dead — silently ignored** by the loader. It is read
   *only* for learner skills in `.omc/skills/`. **Fold trigger keywords into the
   `description` itself** ("Use when the user says `deslop`…"). This is verified in code:
   see the comment in `src/features/builtin-skills/types.ts` and workflow-gating §9.

---

## The leading-word technique

Anchor each skill on **one compact concept the model already carries from pretraining**, and
repeat it through the body. A good leading word recruits a whole prior in a couple of tokens,
so the agent *thinks with it* while running the skill instead of re-reading instructions.

OMC examples:
- `cpr` → **"context firewall"**: the diff crosses into the subagent, only the summary
  crosses back. Once you hold "firewall", the whole skill follows.
- `ralph` → **"the boulder never stops"**: the persistence loop, in four words.
- `context-handoff` → **"a summary explains the past; a handoff enables the future."**

**Prescription:** pick exactly **one** leading word per skill. State it early, then reuse the
*same* word — not a rotating cast of near-synonyms (that is duplication in the body). If you
cannot name the concept in one phrase, the skill probably has more than one job (sprawl).

---

## Invocation control

Whether the model may auto-launch a skill is governed by `disable-model-invocation` — a full
policy already lives in **`docs/shared/workflow-gating.md` §9**. Do not restate it; the load-
bearing facts for an author are:

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

## Size budget & progressive disclosure

Keep `SKILL.md` **under ~500 lines / ~5k tokens**. The body loads in full on activation, so a
bloated skill taxes every run. When detail outgrows that budget, **move it down the
information-hierarchy ladder** — from in-skill step → in-skill reference section → external
file behind a pointer:

- `references/*.md` — deep reference material, tables, extended examples (this skill keeps
  its source-cited frontmatter table in `references/frontmatter-fields.md`).
- `scripts/*` — runnable helpers the skill invokes rather than inlines.
- `assets/*` — templates and fixtures.

OMC **auto-advertises** these: any non-`SKILL.md` file in the skill directory is surfaced at
runtime as a "Skill Resources" section (`src/utils/skill-resources.ts`), so a `references/`
file is discoverable with **zero extra wiring**. Put the 20%-of-the-time detail there and
keep the top level legible.

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

- [ ] **Predictable:** does the skill make the agent behave the same competent way every time?
- [ ] **Description:** third person, leading word front-loaded, states what **and** "Use when
      …", one trigger per branch, no synonym padding, no reliance on `triggers:`.
- [ ] **Leading word:** exactly one concept, named early, reused (not rotated) through the body.
- [ ] **Six failure modes:** no premature completion (claims are verified), no duplication, no
      sediment (dead refs / copied facts removed → linked), no sprawl (one clear job), no
      no-ops (every step changes the outcome), no bare negations (every "don't" has a "do").
- [ ] **Size:** `SKILL.md` under ~500 lines / ~5k tokens; overflow pushed to `references/`.
- [ ] **Frontmatter:** only parsed fields present; no dead `triggers:`/`level:`/`mcpConfig:`.
- [ ] **Invocation:** `disable-model-invocation` decision matches workflow-gating §9 (never
      flag a `Skill()` callee or a gate/router).
- [ ] **Wired:** `.claude-plugin/plugin.json` skills array, a `commands/<name>.md` wrapper
      (must contain `skills/<name>/SKILL.md` and `$ARGUMENTS`), the `omc-reference` registry,
      and any count assertions in `src/__tests__/skills.test.ts` all updated.
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
- **Divergence from the source (`mattpocock/skills`):** that reference makes its
  writing-great-skills doc *user-invoked* to minimize context load. OMC diverges because it
  has skill *generators* that should reach the rubric programmatically — which requires
  model-invocability — and because a precise description keeps the context cost small enough
  to be worth paying.
