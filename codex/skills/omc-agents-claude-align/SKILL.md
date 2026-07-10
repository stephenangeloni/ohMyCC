---
name: omc-agents-claude-align
description: "Audit AGENTS.md against CLAUDE.md and safely synchronize shared guidance."
---

# Align AGENTS.md with CLAUDE.md

Run a read-only audit across the hierarchical instruction scopes, comparing meaning rather than Markdown layout. Classify guidance as aligned, missing, contradictory, Claude-only, Codex-specific, or unrelated content found only in `AGENTS.md`. Report exact files and headings.

When synchronization is requested, treat `CLAUDE.md` as the source for shared behavioral rules, preserve Codex-specific guidance, and translate shared intent into Codex-native wording without copying Claude-only commands, tools, hooks, model aliases, plugin variables, or runtime APIs. If applicable shared guidance exists but the matching file is missing, preview and create `AGENTS.md`; do not create an empty or Claude-only file. If existing `AGENTS.md` content is unrelated, identify its sections and ask whether to keep or remove them before editing that file. Ask before resolving material contradictions, show the proposed and final diffs, then repeat the audit.
