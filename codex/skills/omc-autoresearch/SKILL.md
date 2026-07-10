---
name: omc-autoresearch
description: "Run a stateful experiment loop that keeps measured improvements and rejects regressions."
---

# Autoresearch

Define one mission, an evaluator command, a baseline, a maximum runtime, and a decision log before changing code. Run one hypothesis at a time, measure it, keep only improvements, and revert only changes created by this workflow when a trial loses. Stop on the time limit, target metric, or repeated inability to produce a valid evaluation.
