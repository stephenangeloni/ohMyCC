---
name: omc-fleet-audit
description: "Audit a large repository surface with parallel read-only native agents."
---

# Fleet Audit

Define the invariant, file population, exclusions, and severity rubric. Partition independent read-only slices across native subagents, normalize their findings, deduplicate by root cause, and run an adversarial verification pass. Return a ranked findings list with exact files; do not edit during the audit.
