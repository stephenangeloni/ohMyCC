# Workflow & Persistence-Loop Gating

This document is the single source of truth for **when OMC may escalate a task onto a
background Dynamic Workflow** (the native `Workflow` tool) and **which persistence loop is
authoritative** for a run (`ralph`, native `/goal`, or a bounded workflow). Every heavy
skill links here instead of restating the policy.

**Core principle:** the workflow path is **opt-in, never default.** A Workflow can spawn many
background agents (up to 16 concurrent / 1000 total per run) and costs meaningfully more
tokens than working the same task in conversation. That cost asymmetry is the entire reason
escalation must be explicit and small tasks must be hard-floored to direct execution. This is
the direct tension with OMC's operating principle "choose the lightest-weight path that
preserves quality" — when in doubt, stay light.

> **Scope note:** OMC intentionally did **not** adopt the global `ultracode:` keyword or the
> `/effort ultracode` session mode as auto-triggers. Escalation is driven by (a) **WF-REC
> prompts** — a skill asks the user via `AskUserQuestion` before launching — and (b) explicit
> **per-skill `--workflow` flags**. OMC must **never** set `/effort ultracode` programmatically;
> if the *user* has set it, skills may use Workflow more freely, but OMC never flips it on.

---

## 1. Availability detection + graceful fallback (mandatory)

OMC must never assume a native primitive exists. Every adoption needs (a) availability
detection, (b) graceful fallback to **today's Task/team path**, (c) no hard failure.

| Primitive | Requires | Disabled by | On disable → fallback |
|---|---|---|---|
| **Workflows** (`Workflow` tool) | CC v2.1.154+, paid plan (Pro/Max/Team/Enterprise) or API/Bedrock/Vertex/Foundry; Pro must enable in `/config` | `disableWorkflows` setting · `CLAUDE_CODE_DISABLE_WORKFLOWS=1` · managed settings | Use today's `Task()` fan-out / `team` mode |
| **`/goal`** | CC v2.1.139+, trusted workspace | `disableAllHooks` (any level) · `allowManagedHooksOnly` (managed) | Use `ralph` or `ultragoal` ledger persistence |
| **`ultracode`** | an `xhigh`-capable model (Opus 4.8/4.7) | same as workflows; non-xhigh models hide it | n/a — OMC does not auto-use it |

**Detection method.** Skill prose cannot introspect the `Workflow` tool directly. Prefer a
**session-start capability probe** that records a soft flag (mirroring the `companyContext`
probe pattern), and treat version gating as **advisory, never blocking**. If the probe is
absent or ambiguous, assume the primitive is unavailable and take the Task/team path. OMC
already owns this idiom — `ccg` falls back when Codex/Gemini are absent; `ralph` falls back to
sequential when team mode is unavailable; `ralplan --architect codex` "notes the fallback and
keeps the default." Reuse it verbatim.

**Invariant:** the fallback path *is* today's behavior, so every gated skill is a no-op until a
primitive is actually detected. Adding the gate must not regress current behavior.

---

## 2. Quantified escalation signals

| Signal | Meaning | Threshold |
|---|---|---|
| **N_parallel** | genuinely independent subtasks that could run concurrently | **≥ 4** (below ~4, a couple of in-context `Task()` calls is lighter) |
| **N_files** | files in scope | **≥ 10** (single-file = never) |
| **V** | needs ≥2 *independent, cross-checked* verifiers on a **risky** change (security/auth, migration, public API, architecture) **and** the finding-set is expected to be large | true |
| **C** | large subagent outputs that would otherwise accumulate in the main context window | **≥ 5** |
| **T** | expected output-token budget of the agent work | **≥ ~150k** (or explicit large-budget opt-in) |
| **R** | repeatable process worth saving as a reusable `/command` | true |

---

## 3. Escalation rule

Route to a Workflow-backed path **only when BOTH hold**:

1. The user has **opted in** — a WF-REC prompt was accepted, a `--workflow` flag was passed,
   or natural language ("use a workflow", "run a workflow") requested it; **AND**
2. **At least TWO** of `{ N_parallel≥4, N_files≥10, V, C≥5, T≥150k, R }` are true.

A single signal is never enough. The one opt-in-alone exception: `R` (saving a known-repeatable
process as a command) and an explicit `--workflow` on an already-heavy skill are honored without
a second threshold.

---

## 4. Size × complexity decision matrix

**Size:** **XS** = 1 file / 1 unit · **S** = 2–3 files / ≤2 subtasks · **M** = 4–9 files /
3–5 subtasks · **L** = 10–30 files / 6–15 subtasks · **XL** = >30 files / whole-codebase /
migration / >15 subtasks.

**Complexity:** **Trivial** = mechanical, no design judgment · **Standard** = normal coding,
single likely-correct approach · **High** = risky/ambiguous (security/auth/migration/public-API/
architecture) **or** needs cross-checked verification **or** multiple plausible approaches.

**Routing:** `DIRECT` = main agent, no subagents · `TASK/TEAM` = today's OMC Task fan-out or
team mode · `WF-OPT` = Workflow offered as opt-in, Task/team remains the default ·
`WF-REC` = Workflow recommended — **prompt the user via `AskUserQuestion`; never auto-launch.**

| Size ↓ \ Complexity → | **Trivial** | **Standard** | **High** |
|---|---|---|---|
| **XS** (1 file) | DIRECT | DIRECT | DIRECT + separate verifier lane |
| **S** (2–3 files) | DIRECT | DIRECT (executor) | TASK (consensus plan / verify) |
| **M** (4–9 files) | DIRECT | TASK/TEAM | TASK/TEAM · **WF-OPT** |
| **L** (10–30 files) | TASK | TASK/TEAM · **WF-OPT** | **WF-REC** |
| **XL** (>30 / repo-wide) | TASK/TEAM · **WF-OPT** | **WF-REC** | **WF-REC** |

### Hard floor — DO NOT ESCALATE (no workflow, ever auto)

- The entire **XS** row and the **S/Trivial** + **S/Standard** cells — most routine single-file
  coding.
- Anything that **passes `ralplan`'s concrete-signal gate** (named file / issue# / camelCase or
  PascalCase or snake_case symbol / test runner / numbered steps / acceptance criteria / error
  reference / code block) **and** is ≤3 files. The signal that lets `ralplan` send a task
  straight to direct execution also keeps it off the workflow path.
- **Interactive** skills (`deep-interview`, `deep-dive` Phase 4) — Workflow forbids mid-run input.
- **External-CLI** skills (`ccg`, `ask`, `omc-teams`) — Workflow orchestrates background
  subagents, not Codex/Gemini CLI processes or tmux panes.
- Inside a **Task subagent or team teammate** — they cannot call `Workflow`, and a workflow's own
  agents cannot nest another workflow ("one level only"). Orchestration must live at the **skill**
  layer to qualify.

---

## 5. Trigger surface

- **Default OFF.** The Task/team path stays the default for everything.
- **Opt-in escalation:**
  - Natural language ("use a workflow", "run a workflow") — recognized per-task by the skill.
  - A per-skill **`--workflow`** flag on heavy skills (the `--deliberate` analog: forces the
    heavy path for opted-in / high-risk work even just below thresholds). Currently wired on
    `external-context`; additional skills add it as they are converted.
  - **WF-REC cells** prompt the user via `AskUserQuestion` to opt in — never auto-launch.
- **Inverse escape:** **`direct:` / `--no-workflow`** forces the lightweight path even when
  thresholds cross (cost/latency-sensitive runs). This is the mirror of `ralplan`'s
  `force:` / `!` (those keep their meaning: skip the planning gate, go straight to execution).

---

## 6. Loop-authority invariant

**At most one persistence loop is authoritative per run.** `ralph`, native `/goal`, and a
Workflow loop are all Stop-hook-style or background loops; running two means competing
evaluators, double work, and undefined stop behavior.

- If `ralph` (or `autopilot`/`team`/`ultraqa` under `ralph`) is active: any `/goal` is
  `adopt_existing` / `artifact_only`, and any Workflow is a **bounded background phase**, not a
  competing loop.
- `/goal` may be the authority **only** when no OMC loop is running and its completion condition
  is conversation-surfaceable.
- Reuse the existing resolution vocabulary verbatim: **`refuse` · `adopt_existing` ·
  `artifact_only`.**

### `/goal` vs `ralph` — capability asymmetry

`/goal`'s evaluator **does not call tools**, so it can only judge what Claude has already
surfaced in the conversation — it can be satisfied by an agent that merely *claims* success.
`ralph`'s reviewer **actually runs tests, build, lint, and re-verifies after deslop.** Therefore
`/goal` is a valid *persistence trigger* but **never** a substitute for `ralph`'s *verification
gate*.

| Use `/goal` (via `ultragoal`) when… | Use `ralph` when… |
|---|---|
| Single-session work | Cross-session persistence needed |
| Condition cleanly surfaceable (test exit code, file count, empty queue) | Separate-reviewer verification required |
| No separate-reviewer requirement | Structured PRD story tracking required |
| Want the lightest persistence, no PRD/deslop machinery | Mandatory deslop + regression re-verify |

### Composition: `/goal` first → `ralph` double-checks (preferred when both apply)

When a task wants light single-session persistence **and** a real verification gate, run them as
a **sequential baton-pass — never concurrently** (which would violate the one-authority
invariant):

1. **`/goal` is the loop authority first.** Drive the task under a single `/goal` condition until
   the evaluator reports the condition satisfied (what Claude has surfaced).
2. **On `/goal`'s "done", hand off to `ralph`'s verification gate as a one-shot.** `ralph` (or a
   standalone reviewer pass) independently re-verifies completion with fresh evidence — runs
   tests/build/lint and the reviewer sign-off. The `/goal` loop is now resolved
   (`artifact_only`); `ralph` is authoritative only for the verification turn.
   - If `ralph`'s reviewer **rejects**, the run is **not** done: either re-arm `/goal` with the
     remaining gap as its new condition and loop again, or let `ralph` own the fix loop.
   - If `ralph` **approves**, completion is real (evaluator claim + independent test evidence).
3. **If the composition isn't feasible** (no surfaceable `/goal` condition, or the two cannot be
   cleanly sequenced), **keep `ralph` as the sole authority** from the start. Do not run both
   loops at once.

This respects the invariant: only one loop is authoritative at any instant — `/goal` during
execution, then `ralph` for the verification turn — and it never claims `/goal` independently ran
tests or read files.

> `/goal` and a `Workflow` are different layers: `/goal` is a Stop hook on the *main* session; a
> Workflow runs in the *background* and returns one result. They can compose (a `/goal` turn could
> launch a workflow) but that is advanced. **Never have a Workflow loop AND a `/goal` AND `ralph`
> all active at once** — pick one loop authority and downgrade the others to `artifact_only`.

---

## 7. Token-cost mitigations (bake into skill guidance)

A workflow run counts toward the plan's usage and rate limits. When a skill does escalate:

- **Run on a small slice first** — one directory / one narrow question — to measure real token
  cost before committing the full fan-out.
- **Surface per-agent token visibility** via `/workflows`.
- **Route cheap stages to a smaller model** — `agent(..., {model:'haiku'})`.
- **Respect the caps** — 16 concurrent / 1000 total bound runaway cost.
- **Log silent truncation** — if a workflow bounds coverage (top-N, sampling, no-retry), say what
  was dropped; silent truncation reads as "covered everything" when it didn't.

---

## 8. Quick reference for skill authors

1. Detect availability (§1). Absent/ambiguous → Task/team fallback, stop here.
2. Estimate Size × Complexity (§4). Hard-floor cells → DIRECT/TASK, stop here.
3. Count signals (§2). Apply the escalation rule (§3): opt-in **AND** ≥2 signals.
4. WF-REC cell → prompt via `AskUserQuestion`; WF-OPT → mention the option, default to Task/team.
5. Before launching, confirm the loop-authority invariant (§6): no competing `/goal`/`ralph`.
6. Apply token-cost mitigations (§7); on a first run, pilot a small slice.

---

## 9. User-invoked-only skills (`disable-model-invocation`)

Complementary to §1–§8: those govern **whether a skill escalates to a Workflow**; this governs
**whether the model may auto-launch the skill at all.** Heavyweight orchestrators should not fire
on the model's own initiative from a bare prompt — only when the user explicitly types the command.

**Mechanism.** `disable-model-invocation: true` in a skill's `SKILL.md` frontmatter. Per Claude Code
docs (code.claude.com/docs/en/skills.md line 571 + table lines 349–354), it blocks **both** (a) the
model's autonomous auto-selection **and** (b) programmatic `Skill("…")` invocation by another skill or
hook. Only a literal human `/command` keypress invokes a flagged skill. (Distinct from `user-invocable`,
which only controls menu visibility, **not** Skill-tool access — do not conflate the two.)

**Hard constraint — never flag a `Skill()` target.** Because the flag also blocks programmatic `Skill()`
calls, flagging a skill that another skill invokes via `Skill("oh-my-claudecode:<name>")` **severs that
pipeline.** These are OMC's execution/planning targets and MUST stay model-invocable:

| Must stay model-invocable | Invoked via `Skill()` by |
|---|---|
| `autopilot` | deep-dive, deep-interview |
| `ralph` | deep-dive, deep-interview, ralplan, plan |
| `team` | deep-dive, deep-interview, ralplan, plan |
| `plan` (omc-plan) | deep-dive (`next-skill`), deep-interview |
| `autoresearch` | deep-interview |

`ralplan` is also excluded — it is the **gate** that auto-routes vague `ralph`/`autopilot`/`team`
requests into consensus planning; disabling its model-invocation would defeat that routing.

**Flagged (user-invoked only) — 12 leaf/entry orchestrators with no `Skill()` callers:**
`ultrawork, ultraqa, sciomc, self-improve, ultragoal, fleet-audit, fleet-review, ccg, omc-teams,
deepinit, deep-dive, external-context`.

Unaffected by the flag: the user's `/command`; OMC's magic-keyword **prompt-enhancers**
(`ulw`/`search`/`analyze`/`ultrathink` rewrite the prompt text, they do **not** invoke the same-named
skill); and OMC's auto-slash-command **inline expansion**.

**Discovery note — `triggers:` is not read for builtin skills.** The `triggers:` frontmatter field
drives keyword auto-invocation **only** for learner skills (`.omc/skills/`, via `src/hooks/learner`).
Builtin skills (`skills/*/SKILL.md`) are discovered purely by `description` (native Claude Code) — a
`triggers:` field on a builtin skill is **silently ignored**. Fold trigger keywords into the
`description` (`"Use when …"`); never add `triggers:` to a `skills/*/SKILL.md`.

**Checklist before flagging a new skill user-invoked-only:**
1. Is it ever invoked via `Skill("…name")` in any `SKILL.md` body or `src/hooks`? → if yes, **do not
   flag** (breaks the caller).
2. Is it a `next-skill` / `pipeline` target, or injected via `[MAGIC KEYWORD: name]`? → if yes, **do not
   flag**.
3. Does it have a legitimate auto-invoke role (a gate/router like `ralplan`)? → if yes, **do not flag**.
4. Otherwise, if it is a heavyweight fan-out/loop the model should not self-start → **flag it.**

**⚠️ Verification status.** The Claude Code docs are **silent on whether `disable-model-invocation`
applies to plugin-namespaced skills** (OMC ships as a plugin). It is a safe no-op if unsupported (no
parse error). **Confirm empirically after a plugin reload + full restart:** each flagged skill's
`/command` still runs when typed, and the model no longer auto-invokes it from a bare prompt.
