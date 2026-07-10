# Global Codex Catalog Design

## Goal

Make the personal `ohmycc-local` plugin expose the repository's complete workflow surface in every Codex project on this machine without copying Claude-specific instructions into Codex.

## Architecture

Keep the local marketplace and isolated `codex/` plugin root. Generate a namespaced `$omc-<name>` Codex skill for every source skill. Existing `omc-*` source names are not double-prefixed, and the generic setup router uses `$omc-setup-router` to avoid colliding with `$omc-setup`. Preserve the existing short unprefixed portable adapters for compatibility. The plugin installation makes these skills and the standard OMC MCP server global; `pnpm codex:setup` continues to install native agents, marker-managed guidance, and supported hooks under `$CODEX_HOME`.

Each generated skill contains concise Codex-native instructions written from an explicit catalog entry. It uses native subagents, Codex plan tracking, supported hooks, ordinary shell commands, or the standard MCP boundary as appropriate. Destructive Git, release, merge, push, and notification workflows retain explicit safety gates. Claude-only runtime concepts receive an intentional Codex equivalent or a clear capability fallback; the generator never copies or blindly rewrites Claude skill bodies.

Claude command files map to the corresponding namespaced skill. Codex has no equivalent slash-command directory, so `$omc-ask`, `$omc-debug`, and similar invocations are the command surface. Command aliases do not duplicate workflow bodies.

## Installation and data flow

1. `pnpm codex:build` reads the explicit native catalog and emits all plugin skills and aliases.
2. `pnpm codex:validate` checks source-skill and command coverage, deterministic output, frontmatter, names, forbidden Claude constructs, native-agent TOML, and plugin structure.
3. `pnpm codex:sync` refreshes the cachebuster, reinstalls `oh-my-claudecode@ohmycc-local`, and updates managed global agents, hooks, and guidance.
4. A fresh Codex process in a directory outside this checkout discovers the installed `$omc-*` skills and OMC MCP tools.

## Failure handling

- Fail generation when any source skill or command lacks a catalog mapping.
- Fail validation when a generated skill contains unsupported Claude calls or aliases.
- Preserve unrelated `$CODEX_HOME` content during setup and removal.
- Keep unsupported host-specific behavior explicit at invocation time instead of silently pretending it ran.
- Never modify Claude marketplace, manifest, commands, hooks, or installer files as part of Codex generation.

## Verification

- Red-green tests for complete skill and command coverage, namespaced outputs, alias resolution, and global setup behavior.
- Deterministic build and installed plugin validation.
- Full repository test, build, and lint gates.
- Fresh-context smoke tests from `/tmp` for a portable workflow, a command alias, a native-subagent workflow, and an MCP tool.
- Immutable Claude integration hashes and Claude plugin validation.
