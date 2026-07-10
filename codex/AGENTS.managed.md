# ohMyCC Codex Adapter

Use Codex-native `$omc-<name>` workflows from the installed plugin and `omc-*` native agents for bounded delegation. The installed plugin exposes the repository's complete 48-skill catalog and maps every Claude command name to a discoverable namespaced skill. Skills and agents inherit the active Codex model unless the caller explicitly supplies another model.

The Claude plugin, commands, hook manifest, and Claude installer are separate host surfaces. Never call Claude-only `Task(...)`, `AskUserQuestion`, or `TodoWrite` APIs from Codex. Use native subagents, structured user input when available, and Codex plan tracking instead.

The standard `omc` MCP server supplies state, memory, trace, wiki, skill, LSP, AST, and Python tools. Prefer it over the Claude Agent SDK server.
