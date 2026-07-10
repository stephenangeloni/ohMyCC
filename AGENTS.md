# oh-my-claudecode - Intelligent Multi-Agent Orchestration

This repository is a personal multi-host orchestration harness. Codex uses this file. Claude Code uses `CLAUDE.md`, `.claude-plugin/`, `hooks/hooks.json`, `commands/`, `skills/`, and the Claude installer.

The legacy Claude host identity is descriptive compatibility metadata, not a Codex tool instruction: You are running with oh-my-claudecode (OMC), a multi-agent orchestration layer for Claude Code.

## Operating contract

- Execute clear, reversible local work through implementation and verification without permission handoffs.
- Preserve unrelated user changes and never revert work you did not create.
- Keep diffs small, additive, and reviewable.
- Prefer existing utilities and the standard MCP boundary; do not add an OpenAI SDK dependency.
- Do not publish, push, or commit unless explicitly requested.
- Use fresh test/build/lint evidence before claiming completion.

## Host boundaries

- Never rewrite the Claude `skills/` or `agents/` trees to make them Codex-compatible.
- Treat `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `hooks/hooks.json`, `commands/`, `CLAUDE.md`, and `.mcp.json` as Claude-owned compatibility surfaces.
- Codex plugin assets are generated under `codex/`.
- The repository marketplace is `.agents/plugins/marketplace.json`; its installed plugin source is `./codex` so Codex cannot auto-discover Claude-only root components.
- The root `.codex-plugin/plugin.json` is generated compatibility metadata. The validator/install root is `codex/`, whose canonical companions are `skills/` and `.mcp.json`.
- Project native agents live in `.codex/agents/`; personal synchronization copies only `omc-*` agents to `$CODEX_HOME/agents/`.
- Claude runtime state remains under `.omc/state/`; Codex adapters interoperate through the standard MCP boundary and do not replace that state.

## Codex workflows

- Invoke the complete plugin catalog with `$omc-<name>`. Existing source names that already start with `omc-` keep that name; the generic setup router is `$omc-setup-router`.
- Claude command names are mapped in `codex/command-aliases.json` to discoverable `$omc-*` skills. Codex does not load the Claude `commands/` directory as slash commands.
- Delegate bounded work to Codex native `omc-*` agents. Inherit the active model unless the caller explicitly supplies another model.
- Translate Claude concepts deliberately:
  - Claude task calls become native subagent delegation.
  - Claude interactive questions become Codex structured input when available, otherwise one concise question.
  - Claude todo calls become Codex plan/task tracking.
  - Claude slash commands become `$skill` invocations.
- Do not use Claude tool names, namespaces, plugin-root variables, or model aliases in generated Codex assets.

## Generation and setup

- `pnpm codex:build` regenerates marketplace metadata, plugin manifests, classification, skills, agents, and the cache-contained standard MCP bundle.
- `pnpm codex:validate` checks deterministic drift, all 48 skill adapters, all 33 command aliases, unsupported constructs, every generated skill with the installed skill validator, companion paths, and the installed plugin validator.
- `pnpm codex:setup` updates only OMC-owned agents, the marker-bounded `$CODEX_HOME/AGENTS.md` section, and managed Codex hook entries. Preserve unrelated `config.toml`, hooks, and guidance.
- `pnpm codex:sync` refreshes the cachebuster, rebuilds, validates, idempotently re-adds the local marketplace, reinstalls the local plugin, and synchronizes managed personal assets.

## MCP and hooks

- Use `bridge/mcp-server.cjs` through the generated cache copy `codex/mcp-server.cjs`.
- Do not use `src/mcp/omc-tools-server.ts` for Codex; it is Claude Agent SDK-specific.
- Supported Codex 0.144.1 hook events are SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStart, SubagentStop, and Stop.
- PostToolUseFailure and SessionEnd are unavailable in native Codex and remain capability-gated.
- Codex hook installation is additive and command-identity managed; never edit the Claude hook manifest.

## Verification

For Codex adapter changes, run targeted tests first, then:

```bash
pnpm codex:validate
pnpm test -- --run
pnpm run build
pnpm run lint
codex --version
codex plugin marketplace list
codex plugin list
```

Also verify the immutable Claude hashes, existing installer/MCP regressions, shared OMC/OMX state tests, a real local marketplace install, one portable skill, one native-subagent workflow, and MCP tool discovery.

Claude-only setup reference (do not use it for Codex): Run `omc setup` to install all components. Run `omc doctor` to verify installation.
