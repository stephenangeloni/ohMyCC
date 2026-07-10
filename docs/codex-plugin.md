# Local Codex Plugin

This repository keeps its Claude Code plugin unchanged and adds a separate Codex adapter. The installed Codex plugin root is `codex/` because the installed validator requires canonical `skills/` and `.mcp.json` companions and would otherwise validate the Claude-only root `skills/` tree and auto-load the Claude hook manifest. Generated Codex skills live in `codex/skills/`; native agent sources live in `codex/agents/` and are mirrored into project-local `.codex/agents/`.

## Build and validate

```bash
pnpm codex:build
pnpm codex:validate
```

`codex:build` deterministically regenerates the marketplace, plugin manifest, all 48 Codex-native skill adapters, 33 command aliases, and native agents. The canonical global invocation is `$omc-<name>`. Existing `omc-*` source names are not double-prefixed, and the generic setup router is `$omc-setup-router`. The older unprefixed portable adapters remain available for compatibility.

Codex does not install the Claude `commands/` directory as slash commands. Instead, `codex/command-aliases.json` maps every command filename to a discoverable `$omc-*` skill; for example, `psm` maps to `$omc-project-session-manager` and `learner` maps to `$omc-skillify`.

`codex:validate` checks deterministic drift, complete source-skill and command coverage, unsupported Claude calls, every generated skill with the installed skill validator, companion paths, and the installed Codex plugin validator when available.

## Install and synchronize

```bash
codex plugin marketplace add /Users/angelost/Projects/ohMyCC
codex plugin add oh-my-claudecode@ohmycc-local
pnpm codex:setup
```

`codex:setup` copies only `omc-*` native agent TOMLs and updates only the `OMC:CODEX` managed block in `$CODEX_HOME/AGENTS.md`. It merges the ten supported native Codex hook events into `$CODEX_HOME/hooks.json` while preserving unrelated hooks. Legacy top-level hook trust state is preserved in `$CODEX_HOME/hooks-state.omc-preserved.json` because Codex 0.144.1 stores current trust state in `config.toml` and rejects that legacy field in `hooks.json`. It does not write `~/.claude` and does not modify `$CODEX_HOME/config.toml`.

After repository changes, run:

```bash
pnpm codex:sync
```

This refreshes the cachebuster, rebuilds and validates all generated assets, updates the managed personal agents/guidance/hooks, re-adds the repository marketplace idempotently, and reinstalls the local plugin snapshot. Start a fresh Codex thread after synchronization so the complete catalog is loaded.

To remove only the managed native agents, guidance block, and hooks, run `pnpm codex:remove`. The command leaves user-owned Codex configuration and all Claude files untouched.

## Capability parity

Supported Codex hook events are SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStart, SubagentStop, and Stop. PostToolUseFailure and SessionEnd remain Claude-only because Codex CLI 0.144.1 does not expose them as native plugin hook events.

The plugin MCP companion starts `bridge/mcp-server.cjs`, the standard MCP stdio server. The Claude Agent SDK-specific `src/mcp/omc-tools-server.ts` remains available only to Claude.
