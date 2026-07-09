# Frontmatter fields — what a builtin `SKILL.md` actually does

Source-cited reference for the summary table in `SKILL.md`. Ground truth is the loader,
`src/features/builtin-skills/skills.ts` (`loadSkillFromFile`), plus the `BuiltinSkill` type in
`src/features/builtin-skills/types.ts` and the pipeline parser in `src/utils/skill-pipeline.ts`.
Verify against those files before trusting anything here — a copied fact is future sediment.

## Parsed by the builtin loader

`loadSkillFromFile` (`skills.ts`) constructs each `BuiltinSkill` from exactly these frontmatter
keys. Everything else on the object is left `undefined`.

| Frontmatter key | Maps to | Notes |
|---|---|---|
| `name` | `name` | Passed through `toSafeSkillName` — a name colliding with a native CC command (`review`, `plan`, `security-review`, `init`, `doctor`, `help`, `config`, `clear`, `compact`, `memory`) is prefixed with `omc-`. |
| `description` | `description` | The only field native Claude Code reads for discovery. |
| `aliases` | `aliases` / alias entries | Each alias becomes its own `BuiltinSkill` entry flagged `deprecatedAlias`, deduped against the primary name. |
| `model` | `model` | Optional model hint. |
| `agent` | `agent` | Optional subagent type (e.g. `trace` uses this). |
| `argument-hint` | `argumentHint` | Note the frontmatter key is kebab-case; the field is camelCase. |
| `pipeline` | `pipeline.steps` | Parsed by `parseSkillPipelineMetadata`; skill refs are normalized (leading `/oh-my-claudecode:` stripped, lowercased). |
| `next-skill` | `pipeline.nextSkill` | Normalized skill reference. |
| `next-skill-args` | `pipeline.nextSkillArgs` | Free-form args string. |
| `handoff` | `pipeline.handoff` | Handoff artifact path. |
| `handoff-policy` | `pipeline.handoffRequiresApproval` | `approval-required` / `requires-approval` → `true`. |
| `omc-full-body` | (body override) | Points at the archived full body created by install-time compaction (`readSkillBodyOverride`). Injected automatically by the compaction step — you don't hand-write it. |

## Silently ignored on a builtin `SKILL.md`

Present on the `BuiltinSkill` *type* (`types.ts`) but **never populated from frontmatter** by
`loadSkillFromFile`. Adding them to a `skills/*/SKILL.md` has no effect:

- `triggers` — **dead for builtin skills.** Read only for learner skills in `.omc/skills/`
  (`src/hooks/learner`). The type file even carries an explicit comment saying so
  (`types.ts` line ~60). Fold trigger keywords into `description`.
- `level` — some skills carry it (e.g. `ai-slop-cleaner: level: 3`), but a repo-wide search
  finds no consumer of skill-frontmatter `level` in the builtin loader. Treat as inert.
- `mcpConfig` — the type has `mcpConfig?: SkillMcpConfig`, but the file loader never sets it.
  MCP servers are wired at the plugin level via `plugin.json`'s `mcpServers`, not per-skill
  frontmatter.
- `allowedTools`, `subtask`, `license`, `compatibility`, `metadata` — type-only; not read from
  frontmatter by the file loader.

## Read by native Claude Code, not by OMC's loader

These are real Claude Code frontmatter fields. CC honors them directly; OMC's loader does not
parse them, so no OMC behavior keys off them:

- `disable-model-invocation` — blocks model auto-selection **and** programmatic `Skill()`
  calls; only a human `/command` bypasses it. Policy: `docs/shared/workflow-gating.md` §9.
  Plugin-namespaced support is docs-silent — confirm empirically.
- `user-invocable` — menu visibility only; **not** the same as `disable-model-invocation`.
- `allowed-tools` (kebab-case, native) — CC tool gating. Distinct from the type's
  `allowedTools` field, which the loader ignores.

## Registration surfaces (a new skill must touch all of these)

Adding `skills/<name>/SKILL.md` alone auto-registers the skill for the *runtime* loader
(`loadSkillsFromDirectory` does a `readdirSync` — no source array to edit). But three other
surfaces are checked by tests and tooling:

1. `.claude-plugin/plugin.json` — add `"./skills/<name>/"` to the `skills` array.
   `plugin-skill-budget.test.ts` asserts this array exactly equals the set of skill dirs.
2. `commands/<name>.md` — a thin wrapper that reads `skills/<name>/SKILL.md` and passes
   `$ARGUMENTS` (the budget test verifies both strings are present when a wrapper exists).
3. `skills/omc-reference/SKILL.md` — the human-facing skills registry.
4. `src/__tests__/skills.test.ts` — count assertions and the hand-maintained `expectedSkills`
   array. This hand-maintained mirror is itself a duplication/sediment hazard: it drifts
   whenever the filesystem changes and the array isn't updated.

## Native aside: `context: fork` + `agent:` (not loader-parsed; verified 2026-07)

These are native Claude Code fields — the OMC loader does not read them — recorded here only
because a migration idea hinged on them. A docs-verification pass against the official Claude
Code docs (the skills and sub-agents pages, as of 2026-07) found `context: fork` and `agent:`
are **documented and GA** (min CC ~v2.1.117); `agent:` defaults to `general-purpose` and is
meaningful **only** with `context: fork`. Two silences remain: whether it works for
**plugin-namespaced** skills is **not stated**, and the failure mode for an invalid/unknown
agent type is **unspecified** (the "silently fails" claim is uncorroborated). Because OMC ships
as a plugin, both silences land on OMC's exact case — so do **not** migrate prose-dispatch
skills (`cpr`, `fleet-*`) to `context: fork` until a throwaway plugin-namespaced skill confirms
the behavior empirically. (Exact doc line numbers are deliberately omitted — they drift; cite
the page and re-verify, per this skill's own sediment rule.)
