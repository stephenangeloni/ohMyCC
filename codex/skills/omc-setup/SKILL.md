---
name: omc-setup
description: "Install or refresh this repository's Codex integration."
---

# OMC Setup

For Codex, use the repository's `pnpm codex:build`, `pnpm codex:validate`, `pnpm codex:setup`, and marketplace reinstall flow. Preserve unrelated `$CODEX_HOME` and all Claude files. If the user explicitly requests Claude setup, route to the existing Claude installer without translating it in place.
