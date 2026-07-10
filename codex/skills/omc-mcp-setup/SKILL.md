---
name: omc-mcp-setup
description: "Configure MCP servers for Codex while preserving unrelated configuration."
---

# MCP Setup

Inspect current Codex MCP configuration and prefer the existing standard OMC server when it satisfies the request. Add or update only the named server using supported Codex configuration, preserve unrelated entries, validate command paths and timeouts, and perform a live list-tools smoke test. Never add an SDK dependency when stdio MCP is sufficient.
