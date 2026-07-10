# Global Codex Catalog Implementation Plan

> **For Codex:** Execute this plan task-by-task with tests first. Use native subagents only for independent bounded work. Do not commit or push.

**Goal:** Generate and globally install Codex-native access to every repository skill and command.

**Architecture:** Extend the explicit Codex catalog with one namespaced native adapter per source skill and aliases for command-only names. Keep the plugin as the global skill/MCP distribution mechanism and the setup script as the global agent/guidance/hook mechanism.

**Tech stack:** Node.js ESM generators, Vitest, Codex plugin CLI, standard MCP stdio server.

---

### Task 1: Lock complete catalog coverage

**Files:**
- Modify: `src/codex/__tests__/codex-integration.test.ts`
- Modify: `src/codex/__tests__/mcp-hooks.test.ts`

1. Add a failing test requiring every `skills/*/SKILL.md` source to produce `codex/skills/omc-<name>/SKILL.md`.
2. Add a failing test requiring every `commands/*.md` name to resolve to a generated namespaced skill or declared alias.
3. Require generated frontmatter names to match directories and forbid Claude-only calls.
4. Run the focused tests and confirm they fail because the full catalog is absent.

### Task 2: Add the explicit native workflow catalog

**Files:**
- Modify: `scripts/codex/catalog.mjs`
- Modify: `scripts/codex/build.mjs`

1. Define a deliberate Codex-native description and body for all 48 source workflows.
2. Define command aliases, including `psm -> project-session-manager`.
3. Generate `$omc-<name>` skills and keep existing compatibility adapters.
4. Run `pnpm codex:build` and the focused tests; confirm complete coverage passes.

### Task 3: Strengthen validation and global setup

**Files:**
- Modify: `scripts/codex/validate.mjs`
- Modify: `scripts/codex/setup.mjs`
- Modify: `src/codex/__tests__/codex-integration.test.ts`

1. Add failing validation tests for missing mappings, stale aliases, invalid names, and unsupported constructs.
2. Ensure setup installs only managed native agents and guidance while the plugin remains the single global skill source.
3. Verify repeated setup and removal preserve user-owned Codex and Claude files.

### Task 4: Document and synchronize

**Files:**
- Modify: `docs/codex-plugin.md`
- Modify: `AGENTS.md`
- Modify: `package.json` only if an additional command is required

1. Document `$omc-*` command compatibility and global availability.
2. Document the canonical refresh command, cache behavior, and capability fallbacks.
3. Run `pnpm codex:sync` to reinstall the refreshed local plugin.

### Task 5: Verify every host boundary

1. Run `pnpm codex:validate`.
2. Run focused Codex, installer, MCP, interop, and model-contract tests.
3. Run `pnpm test -- --run`, `pnpm run build`, and `pnpm run lint`.
4. Run the installed plugin validator and inspect `codex plugin list` plus `codex mcp list --json`.
5. Start fresh Codex contexts from `/tmp` and invoke a portable skill, a command alias, a native-subagent workflow, and an MCP tool.
6. Verify immutable Claude hashes and run `claude plugin validate .`.
7. Report any genuine capability gaps and leave the worktree uncommitted.
