---
name: fleet-audit
description: Repo-wide audit or migration sweep across many files via a background Dynamic Workflow, with adversarial verification and a team/Task fallback
argument-hint: "[--migrate] [--no-workflow] <audit goal or migration spec>"
level: 4
---

<Purpose>
Fleet-audit runs a deterministic sweep across a large set of files (10s–100s) — every site
visited, no silent truncation — then adversarially verifies findings and synthesizes one report
(audit mode) or applies and verifies changes (migrate mode). It is OMC's home for the native
`Workflow` tool's headline use case: codebase-wide audits and large migrations. When a background
Workflow is unavailable, it falls back to a `team`/`Task` batch sweep.
</Purpose>

<Relationship>
Distinct from the user-level `/fleet-review` / `/fleet-fix` slash commands (multi-agent review/fix of
a diff). Fleet-audit targets **whole-repo breadth** — a work-list of files/sites rather than a single
changeset — and is Workflow-shaped by design. Use `/fleet-review` for diff review; use `fleet-audit`
for repo-wide sweeps.
</Relationship>

<Use_When>
- A goal spans ≥10 files / a whole subsystem / the whole repo (the workflow escalation threshold).
- A migration must touch many sites consistently (rename, API swap, lint-rule rollout, dependency move).
- You need a guarantee that every site was visited and assessed, with verification, not sampling.
</Use_When>

<Do_Not_Use_When>
- Scope is <10 files — use `/code-review`, `/simplify`, `ralph`, or direct executor delegation (hard floor).
- The task needs mid-run user input — Workflow forbids it; use an interactive skill.
- A single changeset/diff review — use `fleet-review`.
</Do_Not_Use_When>

<Why_This_Exists>
OMC had no native primitive for 10–500-file sweeps. Done by hand, breadth tasks suffer agentic
laziness (sites silently skipped) and context accumulation (per-file output piling into the lead
window). A Dynamic Workflow fixes both: the work-list is enumerated up front, each site is processed
in an isolated agent whose result lives in a script variable, and only the synthesis returns.
</Why_This_Exists>

<Gating>
Invoking `/fleet-audit` IS the explicit opt-in. The skill still applies the policy in
`docs/shared/workflow-gating.md`:
- **Availability + fallback (mandatory):** detect Workflow availability at start. If unavailable
  (or `--no-workflow` / `direct:` given), fall back to a `team N:executor` / batched `Task()` sweep
  over the same work-list and note the fallback in one line. Never hard-fail.
- **Hard floor:** if the discovered work-list is <10 sites, stop and recommend the lighter path
  instead of spawning a fleet.
- **Migrate isolation:** in `--migrate` mode, parallel agents mutate files, so use
  `agent(..., { isolation: 'worktree' })` (expensive — justified only because parallel writes would
  conflict). Audit mode is read-only and needs no worktrees.
- **Cost:** pilot a small slice first (one directory) to measure token cost; route cheap per-site
  passes to a smaller model; respect the 16-concurrent / 1000-total caps; log any bounded coverage.
</Gating>

<Steps>
1. **Scout the work-list (inline, in the main agent).** Enumerate the target sites with Grep/Glob/
   `git` — the files or symbols in scope. This is cheap and discovers the fleet size. If <10 sites →
   hard floor (recommend lighter path). Record the list.
2. **Sweep (workflow).** Author one `Workflow` (`meta.name: 'fleet-audit'`) that pipelines each site
   through process → verify, holding per-site results in script variables. Only the synthesis returns.
3. **Adversarially verify findings.** Each finding (audit) or edit (migrate) is checked by an
   independent verifier prompted to refute; keep only those that survive.
4. **Synthesize.** Audit → one ranked report with per-site evidence and an explicit count of sites
   covered/dropped. Migrate → apply surviving edits, run the project's build/test/lint, report.
5. **Fallback path (no Workflow):** run the same work-list via `team N:executor` or batched `Task()`
   fan-out; same verify + synthesize stages, minus the script-variable context relief.
</Steps>

<Workflow_Sketch>
```js
export const meta = {
  name: 'fleet-audit',
  description: 'Repo-wide audit/migration sweep with adversarial verification',
  phases: [{ title: 'Sweep' }, { title: 'Verify' }, { title: 'Synthesize' }],
}
const SITES = args.sites            // the scouted work-list (≥10)
const MIGRATE = args.migrate === true
const processed = await pipeline(
  SITES,
  site => agent(`${MIGRATE ? 'Apply the migration to' : 'Audit'} ${site}: ${args.goal}. Return findings/edits + evidence.`,
    { label: `site:${site}`, phase: 'Sweep', schema: SITE_SCHEMA,
      ...(MIGRATE ? { isolation: 'worktree' } : {}), agentType: 'oh-my-claudecode:executor' }),
  (res, site) => agent(`Adversarially verify the result for ${site}. Default to rejected if uncertain.`,
    { label: `verify:${site}`, phase: 'Verify', schema: VERDICT_SCHEMA }).then(v => ({ site, res, v })))
const kept = processed.filter(Boolean).filter(p => p.v?.confirmed)
log(`covered ${SITES.length} sites, ${kept.length} confirmed, ${SITES.length - processed.filter(Boolean).length} dropped`)
return await agent(`Synthesize a ranked report from: ${JSON.stringify(kept)}`, { phase: 'Synthesize' })
```
Notes: a site that throws drops to `null` — `.filter(Boolean)` and **log the drop count**; never
truncate silently. Adversarial verify runs as soon as each site's sweep completes (pipeline, no barrier).
</Workflow_Sketch>

<Configuration>
- `--migrate` switches from read-only audit to apply-changes mode (worktree-isolated agents).
- `--no-workflow` / `direct:` forces the `team`/`Task` fallback sweep even when a Workflow is available.
- Default mode is read-only audit. Policy and thresholds: `docs/shared/workflow-gating.md`.
</Configuration>
