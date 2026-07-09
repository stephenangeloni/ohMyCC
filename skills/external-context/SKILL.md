---
name: external-context
description: Invoke parallel document-specialist agents for external web searches and documentation lookup
disable-model-invocation: true
argument-hint: "[--workflow] <search query or topic>"
level: 4
---

# External Context Skill

Fetch external documentation, references, and context for a query. Decomposes into 2-5 facets and spawns parallel document-specialist Claude agents.

By default the facets run as in-context `Task()` calls (Step 2). When the run is opted into a
background Dynamic Workflow (`--workflow` / "use a workflow") **and** a Workflow is available, the
facet reports are held in script variables and only the synthesis returns — removing context
accumulation. This is OMC's pilot adoption of the native `Workflow` tool; see
`docs/shared/workflow-gating.md`.

## Usage

```
/oh-my-claudecode:external-context <topic or question>
/oh-my-claudecode:external-context --workflow <topic or question>
```

### Examples

```
/oh-my-claudecode:external-context What are the best practices for JWT token rotation in Node.js?
/oh-my-claudecode:external-context Compare Prisma vs Drizzle ORM for PostgreSQL
/oh-my-claudecode:external-context Latest React Server Components patterns and conventions
```

## Protocol

### Step 1: Facet Decomposition

Given a query, decompose into 2-5 independent search facets:

```markdown
## Search Decomposition

**Query:** <original query>

### Facet 1: <facet-name>
- **Search focus:** What to search for
- **Sources:** Official docs, GitHub, blogs, etc.

### Facet 2: <facet-name>
...
```

### Step 2: Parallel Agent Invocation

Fire independent facets in parallel via Task tool:

```
Task(subagent_type="oh-my-claudecode:document-specialist", model="sonnet", prompt="Search for: <facet 1 description>. Use WebSearch and WebFetch to find official documentation and examples. Cite all sources with URLs.")

Task(subagent_type="oh-my-claudecode:document-specialist", model="sonnet", prompt="Search for: <facet 2 description>. Use WebSearch and WebFetch to find official documentation and examples. Cite all sources with URLs.")
```

Each facet prompt MUST instruct the agent to end with its sentinel: `OMC-VERDICT: document-specialist | <ANSWERED|PARTIAL|NOT-FOUND> | <summary>` (per `docs/shared/agent-return-contract.md`).

Maximum 5 parallel document-specialist agents.

**Facet completeness check (before Step 3 synthesis):** read each facet's `OMC-VERDICT` sentinel. Re-dispatch or explicitly flag any `PARTIAL`/`NOT-FOUND` facet, and treat a missing/empty return as `NOT-FOUND` — never a silent success. Never drop a facet without recording it (the `--workflow` variant enforces this via `.filter(Boolean)` + drop-count logging; the default path must match).

### Step 2 (workflow variant): background fan-out-and-synthesize

Take this path **only when** the run is opted in (`--workflow` flag or natural language "use a
workflow"/"run a workflow") **AND** a background Workflow is available **AND** the query decomposed
into **≥4 independent facets** (the escalation threshold). If any condition fails — no opt-in, no
Workflow capability, or <4 facets — **fall back to the default Step 2 `Task()` fan-out above** and
note the fallback in one line. Never hard-fail.

When taken, author a single `Workflow` whose `meta.name` is `external-context` with one
`document-specialist` agent per facet, run concurrently, each returning a structured facet report
held in a script variable. Only the final synthesis returns to the main context:

```js
export const meta = {
  name: 'external-context',
  description: 'Parallel external-doc facets → single synthesis',
  phases: [{ title: 'Facets' }, { title: 'Synthesize' }],
}
const FACET_SCHEMA = { /* findings[], sources[] per facet */ }
const facets = await parallel(FACETS.map(f => () =>
  agent(`Search for: ${f.description}. Use WebSearch and WebFetch to find official documentation `
      + `and examples. Cite all sources with URLs.`,
      { label: `facet:${f.name}`, phase: 'Facets', schema: FACET_SCHEMA,
        agentType: 'oh-my-claudecode:document-specialist' })))
const synthesis = await agent(
  `Synthesize these facet reports into the Step 3 output format. Reports: ${JSON.stringify(facets.filter(Boolean))}`,
  { phase: 'Synthesize' })
return synthesis
```

Notes:
- Respect the 5-facet maximum (the facet array is the work-list; it never exceeds 5 here).
- A facet that throws resolves to `null`; `.filter(Boolean)` before synthesizing and log how many
  facets were dropped — never silently truncate.
- The synthesis agent (or the main agent after the workflow returns) emits the Step 3 format below.

### Step 3: Synthesis Output Format

Present synthesized results in this format:

```markdown
## External Context: <query>

### Key Findings
1. **<finding>** - Source: [title](url)
2. **<finding>** - Source: [title](url)

### Detailed Results

#### Facet 1: <name>
<aggregated findings with citations>

#### Facet 2: <name>
<aggregated findings with citations>

### Sources
- [Source 1](url)
- [Source 2](url)
```

## Configuration

- Maximum 5 parallel document-specialist agents
- No magic keyword trigger - explicit invocation only
- `--workflow` (or "use a workflow") opts this run into the background Dynamic Workflow variant of
  Step 2 when available and ≥4 facets; `direct:` / `--no-workflow` forces the default in-context
  `Task()` fan-out. Default remains the in-context path. Policy: `docs/shared/workflow-gating.md`.
