# Codex Plugin Adapter Implementation Plan

> **For Codex:** Execute this plan task-by-task using TDD and native subagents for independent read-only research. Do not commit or publish.

**Goal:** Make this checkout installable as a local Codex plugin with native skills, agents, MCP, guidance, and supported lifecycle hooks while preserving the existing Claude Code integration byte-for-byte.

**Architecture:** Keep Claude assets authoritative and untouched. Add a Codex-only adapter rooted at `codex/`, a repository marketplace at `.agents/plugins/marketplace.json`, a root `.codex-plugin/plugin.json`, and deterministic generators/setup utilities under `scripts/codex/`. Plugin-discoverable skills and the standard MCP server travel through the plugin; native agents, global `AGENTS.md`, and hooks are installed additively through marker-managed personal setup.

**Tech Stack:** Node.js ESM, TypeScript/Vitest, Codex CLI 0.144.1, JSON/TOML configuration, standard MCP stdio transport.

---

### Task 1: Lock host boundaries and schemas

**Files:**
- Test: `src/codex/__tests__/assets.test.ts`
- Test: `src/codex/__tests__/setup.test.ts`

1. Snapshot and assert the Claude marketplace, plugin manifest, hooks manifest, commands tree, and `CLAUDE.md` remain unchanged.
2. Assert the Codex marketplace resolves its local source to the repository root.
3. Assert the Codex plugin manifest contains only validator-supported fields and points to existing Codex-only skills and MCP configuration.
4. Run the focused tests and confirm they fail because the Codex adapter does not exist.

### Task 2: Implement deterministic Codex asset generation

**Files:**
- Create: `scripts/codex/catalog.mjs`
- Create: `scripts/codex/build.mjs`
- Create: `scripts/codex/validate.mjs`
- Create: `codex/skill-classification.json`
- Generate: `codex/skills/*/SKILL.md`
- Generate: `codex/agents/*.toml`
- Create: `.agents/plugins/marketplace.json`
- Create: `.codex-plugin/plugin.json`
- Create: `.codex-plugin/.mcp.json`

1. Define an explicit per-skill classification: portable, adapted, or unavailable.
2. Generate a small proven portable set and an adapted native-subagent workflow; leave Claude-only skills classified but unexposed.
3. Generate concise Codex-native agent TOML from an explicit role catalog without Claude model aliases or tool vocabulary.
4. Make generation stable and add a `--check` drift mode.
5. Run focused tests until deterministic generation, classification completeness, forbidden-construct checks, and TOML validation pass.

### Task 3: Implement marker-managed personal setup

**Files:**
- Create: `scripts/codex/setup.mjs`
- Create: `scripts/codex/hook-adapter.mjs`
- Create: `codex/AGENTS.managed.md`
- Create: `codex/hooks.json`
- Modify: `package.json`

1. Install generated native agents into `$CODEX_HOME/agents` using an OMC-owned filename prefix.
2. Merge only an OMC-managed section into `$CODEX_HOME/AGENTS.md`.
3. Merge supported Codex events into `$CODEX_HOME/hooks.json`, preserving unrelated entries and avoiding duplicate managed hooks.
4. Preserve unrelated `$CODEX_HOME/config.toml` content; only add marker-owned configuration if runtime discovery proves it necessary.
5. Add `codex:build`, `codex:validate`, `codex:setup`, and `codex:sync` scripts.
6. Run setup tests against temporary homes for preservation, idempotency, host isolation, dual setup, refresh, and removal behavior.

### Task 4: Verify MCP and lifecycle parity

**Files:**
- Test: `src/codex/__tests__/mcp.test.ts`
- Test: `src/codex/__tests__/hooks.test.ts`

1. Start the plugin MCP command from both the checkout and a copied cache-like directory.
2. Send MCP initialize/list-tools requests and assert expected OMC tools are returned.
3. Verify supported hook payloads normalize safely for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, PostCompact, and Stop.
4. Assert Claude-only events are documented as unavailable/capability-gated and are not installed for Codex.

### Task 5: Validate, install, and smoke test both hosts

**Files:**
- Create: `docs/codex-plugin.md`

1. Run `pnpm codex:build`, `pnpm codex:validate`, and setup twice in a temporary home and the real personal home.
2. Run the installed plugin validator and exact Codex marketplace add/plugin add commands.
3. Start a fresh non-interactive Codex context to verify skill discovery, invoke one portable skill and one adapted subagent workflow, and confirm MCP tool discovery.
4. Verify Claude marketplace/plugin JSON still validate and the Claude plugin remains listed/usable.
5. Run focused tests, `pnpm test -- --run`, `pnpm run build`, `pnpm run lint`, and existing shared-state tests.
6. Re-hash immutable Claude files and commands; report exact results and any environment-limited gap.
