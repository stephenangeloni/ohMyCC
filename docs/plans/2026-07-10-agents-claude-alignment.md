# AGENTS and CLAUDE Alignment Skill Implementation Plan

> Execute this plan task by task using red-green-refactor and Codex-native tools.

**Goal:** Add `$omc-agents-claude-align`, a generated Codex skill that audits and safely synchronizes `AGENTS.md` with scoped `CLAUDE.md` guidance.

**Architecture:** Add one Codex-only catalog definition without changing the Claude-owned skill tree or manifest. Extend the existing integration contract test before implementation, then regenerate all Codex assets through the established deterministic builder.

**Tech Stack:** Markdown skills, Node.js generator scripts, Vitest, pnpm.

---

### Task 1: Lock the generated skill contract

**Files:**

- Modify: `src/codex/__tests__/codex-integration.test.ts`

1. Add assertions that the generated `$omc-agents-claude-align` skill exists.
2. Require language covering hierarchical discovery, read-only audit, missing `AGENTS.md` creation, Claude-only exclusions, preservation of Codex-specific guidance, and an explicit keep/remove question for unrelated content.
3. Run the focused test and confirm it fails because the skill does not exist.

Command:

```bash
pnpm test -- --run src/codex/__tests__/codex-integration.test.ts
```

Expected: failure referencing the missing generated skill.

### Task 2: Add the Codex-only skill definition

**Files:**

- Modify: `scripts/codex/catalog.mjs`
- Modify: `scripts/codex/build.mjs`
- Modify: `scripts/codex/validate.mjs`

1. Add the Codex-native catalog entry with the audit and synchronization safety contract.
2. Mark it as Codex-only so source-skill parity checks continue to cover only Claude-owned skills.
3. Keep it out of Claude classification metadata and report generated versus adapted skill counts accurately.
4. Run `pnpm codex:build` to generate `codex/skills/omc-agents-claude-align/SKILL.md`.
5. Re-run the focused tests and confirm they pass.

### Task 3: Validate generation and repository contracts

**Files:**

- Generated: `codex/skills/omc-agents-claude-align/SKILL.md`
- Generated: `codex/skill-classification.json`

Run:

```bash
pnpm codex:validate
pnpm test -- --run
pnpm run build
pnpm run lint
```

Inspect failures before changing code. Do not rewrite unrelated dirty-worktree changes. Report any validation gap with the exact failing command and cause.
