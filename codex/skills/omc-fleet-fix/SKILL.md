---
name: omc-fleet-fix
description: "Apply a verified findings list in small sequential changes."
---

# Fleet Fix

Require a concrete verified findings list. Order fixes by dependency and risk, add regression tests first, and assign bounded native executors only to non-overlapping files. Integrate sequentially, verify after each batch, and stop rather than guessing when a finding lacks enough evidence.
