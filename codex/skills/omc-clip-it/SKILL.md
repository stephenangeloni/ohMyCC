---
name: omc-clip-it
description: "Copy supplied text or the current response to the macOS clipboard."
---

# Clip It

Choose the exact text the user requested. If the current response text is unavailable, ask for or reconstruct only the smallest explicit payload. Pipe the final text to `pbcopy`, avoid adding commentary to the clipboard content, and report the byte or line count. On non-macOS systems, state that this adapter requires `pbcopy`.
