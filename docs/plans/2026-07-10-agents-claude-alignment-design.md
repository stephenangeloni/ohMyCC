# AGENTS and CLAUDE Alignment Skill Design

## Goal

Add a repository-managed Codex skill that compares hierarchical `AGENTS.md` and `CLAUDE.md` guidance, reports semantic drift, and can safely synchronize shared rules into `AGENTS.md`.

## Behavior

The skill scans from the project root through relevant nested directories and pairs instruction files by scope. It classifies guidance as shared, Claude-specific, Codex-specific, contradictory, missing from `AGENTS.md`, or unrelated.

The audit is read-only by default. Its report names each affected file and explains why an item belongs in its category.

When synchronization is requested, the skill treats `CLAUDE.md` as the source for shared behavioral guidance. It preserves Codex-specific guidance and excludes Claude-only tool names, commands, hooks, model aliases, and runtime APIs.

If a directory contains `CLAUDE.md` but no `AGENTS.md`, synchronization creates `AGENTS.md` with the applicable shared guidance. It does not create empty files or files containing only Claude-specific material.

If an existing `AGENTS.md` contains guidance unrelated to `CLAUDE.md`, the skill asks whether to keep or remove that content before editing. It asks one concise question that identifies the exact sections. Until answered, it leaves the file unchanged.

## Safety Boundaries

- Never edit during the audit phase.
- Preview synchronization changes before writing.
- Preserve unrelated user files and existing Codex-specific guidance.
- Never silently delete or rewrite unrelated `AGENTS.md` content.
- Stop on ambiguous contradictions that materially change behavior.
- Show the final diff and re-run the alignment audit after synchronization.

## Repository Integration

The Codex-only source definition lives in `scripts/codex/catalog.mjs`, and `pnpm codex:build` generates the namespaced plugin skill under `codex/skills/`. It remains outside the Claude-owned `skills/` tree and Claude plugin manifest. Regression coverage in the Codex integration suite locks discovery, creation, preservation, explicit-decision behavior, and host ownership into the generated skill contract.

## Validation

Run the targeted Codex integration test, regenerate Codex assets, validate generated skills and plugin metadata, and run the broader repository checks required for Codex adapter changes when feasible.
