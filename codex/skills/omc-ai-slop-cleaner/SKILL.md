---
name: omc-ai-slop-cleaner
description: "Clean generated code with a regression-safe, deletion-first workflow."
---

# AI Slop Cleaner

Write a cleanup plan before editing. Lock behavior with focused regression tests, then make small passes for dead code, duplication, needless abstraction, naming, and boundary repair. Prefer deletion and existing utilities. Use separate native executor and reviewer passes for high-impact cleanup, and finish with lint, typecheck, tests, and static analysis.
