---
description: Multi-agent code review pipeline with cross-model verification
---

# /fleet-review — Multi-Agent Code Review Pipeline

You are running the `/fleet-review` skill. This orchestrates parallel review agents
(Claude + Codex) followed by cross-model verification to find bugs that single-pass
reviews miss.

The core insight: different agents loading files in different orders build different mental
models of the code, which means different bugs surface. Adding model diversity (Claude + GPT)
compounds this effect. Then verification eliminates false positives.

**What makes this version different:** instead of always running the same 3 fixed angles,
a triage step analyzes the diff and selects the most relevant review angles from a catalog.
A CSS-only change gets different reviewers than a database migration.


## Review Angle Catalog

Below are the available review specializations. The triage step (Step 2) selects which
ones to run based on the diff content. Each angle is identified by a short `id`.

### `logic` — Logic & Correctness
**When relevant:** Always relevant for any code change. Core default.
**Prompt focus:**
- Off-by-one errors, wrong comparisons, inverted conditions
- State mutations that could cause unexpected behavior
- Broken invariants, missing null checks on critical paths
- Incorrect algorithm implementations
- Data flow issues where values could be wrong

### `spec-contract` — Spec vs. Implementation Contract
**When relevant:** Mandatory — always included alongside `logic` unless the diff is pure
config/styling. The only review angle whose job is to hold the code accountable to what
its own docstrings and comments promise.
**Prompt focus:**
- Scan every module docstring, class docstring, function docstring, and load-bearing comment
  in the diff for promises, invariants, and claims
- Typical claim phrases to hunt for: "atomic", "thread-safe", "idempotent", "zero drift",
  "halts on X", "reconstructs Y from Z", "always fires before N", "guaranteed to",
  "will never", "must", "reorders", "recovers", "escalates", "retries until"
- For each promise, trace at least one code path and confirm the code actually honors it —
  flag every disagreement
- Specific patterns to flag:
  - Documented recovery paths that aren't implemented (docstring says "on failure, X";
    code just returns / swallows the error)
  - Documented invariants that aren't enforced (docstring says "qty > 0"; code has no guard)
  - Fields or columns claimed to be reconstructed / persisted / emitted but absent from
    the schema, dataclass, or output
  - Error-handling paths claimed to escalate, alert, or halt that only log
  - Parity / equivalence claims (e.g. "matches backtest", "same as production",
    "drop-in replacement") where the code path silently differs
  - Preconditions declared in the docstring that callers can violate without a check
- Do not just catch typos in docs — catch cases where the code *lies* about what it does,
  because those are the bugs that ship

### `security` — Security & Input Validation
**When relevant:** Changes that handle user input, authentication, authorization, API endpoints,
database queries, file operations, or configuration. Changes touching routes, middleware, or
request handlers.
**Prompt focus:**
- Injection vectors (SQL, command, XSS, template)
- Authentication/authorization bypasses
- Sensitive data exposure (secrets, PII, tokens in logs)
- Missing input validation or sanitization
- SSRF, path traversal, insecure deserialization
- Race conditions that could be exploited
- Insecure defaults or configurations

### `edge-cases` — Edge Cases & Error Handling
**When relevant:** Changes with I/O operations, network calls, parsing, resource management,
or complex control flow. Always relevant when error handling patterns change.
**Prompt focus:**
- Missing error handling on I/O, network, or parsing operations
- Unhandled promise rejections or uncaught exceptions
- Resource leaks (file handles, connections, memory)
- Boundary conditions (empty arrays, zero values, max int)
- Timeout handling and retry logic gaps
- Graceful degradation failures
- Error messages that leak internal details

### `perf` — Performance & Scalability
**When relevant:** Changes touching database queries, loops over collections, caching logic,
rendering hot paths, bundle-affecting imports, or data structures. Also relevant for changes
in request handlers that could affect latency.
**Prompt focus:**
- N+1 queries, missing indexes, full table scans
- Unbounded loops or recursion
- Memory allocation in hot paths
- Missing or broken caching
- Unnecessary re-renders or re-computations
- Bundle size impact from new imports
- Algorithmic complexity issues (O(n^2) where O(n) is possible)

### `api-contract` — API Contract & Backwards Compatibility
**When relevant:** Changes to API routes, tRPC procedures, GraphQL schemas, REST endpoints,
response shapes, request validation schemas, or public function signatures. Also relevant
for database schema changes that affect API responses.
**Prompt focus:**
- Breaking changes to request/response shapes
- Missing versioning or migration path for existing clients
- Changed default values that alter behavior for existing callers
- Removed or renamed fields without deprecation
- Changed error codes or error response formats
- SDK/client library compatibility issues

### `data-integrity` — Database & Data Integrity
**When relevant:** Changes to schema files, migrations, ORM models, transaction logic,
seed data, or any code that writes to the database. Also relevant for changes to
background jobs that process data.
**Prompt focus:**
- Missing or incorrect foreign key constraints
- Unsafe migrations (data loss, long locks, missing backfill)
- Transaction boundaries (writes that should be atomic but aren't)
- Inconsistent state from partial failures
- Missing cascade deletes or orphaned records
- Type mismatches between schema and application code
- Concurrent write conflicts

### `concurrency` — Concurrency & Race Conditions
**When relevant:** Changes involving async operations, shared state, queues, background jobs,
cron tasks, distributed locks, or optimistic updates. Also relevant when multiple request
handlers could modify the same resource.
**Prompt focus:**
- TOCTOU (time-of-check-to-time-of-use) races
- Missing locks or overly broad locks
- Deadlock potential from lock ordering
- Lost updates from concurrent modifications
- Queue processing ordering assumptions
- Stale reads in eventually-consistent contexts
- Promise/async pitfalls (missing await, unhandled concurrent errors)

### `types` — Type Safety & Type Correctness
**When relevant:** TypeScript/Flow changes with complex generics, type assertions (`as`),
`any` usage, union/intersection types, or changes to shared type definitions. Also relevant
for changes to serialization/deserialization boundaries.
**Prompt focus:**
- Unsafe type assertions (`as any`, `as unknown as X`)
- Type narrowing gaps (missing discriminant checks)
- Generic constraints that are too loose or too tight
- Runtime values that could violate compile-time types
- Serialization boundaries where types lie (JSON.parse, API responses)
- Enum exhaustiveness gaps (missing switch cases)
- Incorrect type exports that affect downstream consumers

### `ui-ux` — UI/UX & Accessibility
**When relevant:** Changes to React components, CSS/styling, HTML templates, form handling,
client-side state management, or user-facing text. Also relevant for changes that affect
loading states, error displays, or navigation.
**Prompt focus:**
- Missing loading/error/empty states
- Broken keyboard navigation or focus management
- Missing ARIA attributes or semantic HTML
- Layout shifts from async content
- Inconsistent responsive behavior
- Form validation UX (timing, messaging, field states)
- Internationalization issues (hardcoded strings, RTL, pluralization)

### `config-deploy` — Configuration & Deployment
**When relevant:** Changes to environment variables, CI/CD files, Docker/container configs,
build scripts, package.json scripts, infrastructure-as-code, or deployment manifests.
**Prompt focus:**
- Missing environment variables in deployment configs
- Build-time vs runtime config confusion
- Secrets accidentally hardcoded or logged
- Feature flags with incorrect defaults
- Incompatible dependency versions
- Missing health checks or readiness probes
- Rollback safety (can this deploy be safely reverted?)

### `test-coverage` — Test Coverage Gaps
**When relevant:** Changes that add new behavior, modify existing behavior, or touch
code paths that have corresponding test files. Especially relevant when tests are NOT
included alongside behavioral changes.
**Prompt focus:**
- New code paths with no corresponding tests
- Modified behavior where existing tests weren't updated
- Test assertions that don't actually verify the changed behavior
- Missing edge case test coverage for new logic
- Integration test gaps for cross-module changes
- Mocked dependencies that hide real integration issues

### `migration-safety` — Migration & Schema Safety
**When relevant:** Database migration files, schema changes, data backfill scripts,
or changes that modify the shape of persisted data (including config files, cache formats,
or local storage schemas).
**Prompt focus:**
- Migrations that require downtime (large table locks)
- Missing backward-compatible deploy ordering (code-first vs schema-first)
- Data loss from column drops or type changes without backfill
- Non-reversible migrations without rollback scripts
- Foreign key additions on large tables without index consideration
- DEFAULT values that don't match application assumptions


## Scope defaults & how to broaden

Several angles have ambiguous scope — the word "spec", "contract", "coverage", or "schema"
can be read narrowly (in-diff, in-code) or broadly (external artifacts, production state,
memory files, design docs). By default the skill reads them **narrowly**: in-diff and
in-code sources only, so reviewers finish in bounded time and false positives stay low.
When the user needs the broader reading they say so at Step 2.

Step 2 MUST surface the entries below for whichever angles were selected, so the user
sees what the fleet will (and won't) do by default and how to expand it before agents
spawn. If an angle is not in this table, its catalog focus list is the full scope.

| Angle              | Default scope (no guidance)                                 | Broader scope (user must request)                                                                                       | Example broadening phrase                                                                                          |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `spec-contract`    | Docstrings + load-bearing comments in the diff only         | Also audit implementation against external spec artifacts: `SPEC.md`, `docs/**`, ADRs, design notes, memory/notepad files, issue acceptance criteria | "Also check implementation against `docs/trade-protocol.md` and memory file `project_v7_live_deployment.md`"       |
| `api-contract`     | In-code type signatures and response-shape literals         | Also verify against OpenAPI / Protobuf / GraphQL schema files and/or generated consumer SDKs                            | "Also verify responses against `openapi.yaml` and the client at `sdk/ts/src/generated/`"                           |
| `test-coverage`    | New/changed code paths in the diff vs. tests in the diff    | Also check against overall project coverage targets or tests outside the diff that indirectly exercise the changed code | "Also check against coverage target in `pyproject.toml` and tests under `tests/integration/` that cover this API"  |
| `data-integrity`   | Schema diff vs. application code in the diff                | Also verify against a production schema snapshot or known-bad row profiles                                              | "Assume prod table `orders` has 50M rows; check this migration under that profile"                                 |
| `migration-safety` | Migration file + direct consumers in the diff               | Also verify deploy ordering across services / rollback plan against current production schema                           | "Also verify against services listed in `deploy/services.yaml` that read this table"                               |
| `config-deploy`    | Diff files only (env vars, CI, Dockerfiles in the diff)     | Also cross-check against deployed infra state (existing secrets, running services, actual feature-flag defaults in prod)| "Also verify against the secrets inventory in `SECRETS.md` and current Linode systemd unit configs"                |

When the user gives a broadening phrase, propagate it verbatim into the matching angle's
prompt in Step 3 (append under a `BROADENED SCOPE:` header after the standard focus bullets),
so the reviewer knows to read those extra files.


## Step 0: Preflight checks

### Check codex binary

`which codex` is not enough. Some users have a wrapper script earlier on
`$PATH` (e.g. `~/.superset/bin/codex` is a Bash wrapper that hangs forever
when invoked from a non-interactive shell — backgrounded `codex exec` calls
sit at 0% CPU and never make an API request). Resolve to the real binary
and capture it in `CODEX_BIN` for use in Steps 3 and 5.

```bash
CODEX_BIN=""
for cand in /opt/homebrew/bin/codex /usr/local/bin/codex "$(command -v codex 2>/dev/null)"; do
  [ -z "$cand" ] && continue
  # Skip known-bad wrappers (extend this list if new ones surface)
  case "$cand" in *.superset*) continue ;; esac
  # The real codex is a Rust binary; wrappers are usually shell scripts.
  # Mach-O / ELF check filters wrappers out without spending API tokens.
  if [ -x "$cand" ] && file -b "$cand" 2>/dev/null | grep -qE 'Mach-O|ELF'; then
    CODEX_BIN="$cand"
    break
  fi
done
echo "${CODEX_BIN:-NOT_FOUND}"
```
If the result is `NOT_FOUND`: tell the user "Codex CLI not found (or only a
wrapper is installed). Install: `brew install codex` (macOS) or
`npm install -g @openai/codex`" and offer to run the review with Claude
subagents only (skip all Codex steps).

### Detect base branch
```bash
BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || \
       gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || \
       echo "main")
echo "$BASE"
```

### Get the diff stats
```bash
git diff origin/$BASE --stat 2>/dev/null | tail -5
```
If no diff exists, tell the user: "No changes against $BASE. Make some commits first."

### Capture the diff early (needed for triage)
```bash
DIFF_FILE=$(mktemp /tmp/fleet-review-diff-XXXXXX.patch)
git diff origin/$BASE > "$DIFF_FILE"
echo "$DIFF_FILE"
```

Also capture a file list:
```bash
git diff origin/$BASE --name-only
```


## Step 1: Triage — Select review angles

Spawn a **haiku** subagent (fast, cheap) to analyze the diff and select the most relevant
review angles. This is the key intelligence step.

**Triage agent prompt:**
```
You are a code review triage agent. Analyze this diff and select the most relevant review
angles from the catalog below.

Diff file: $DIFF_FILE
Changed files:
$FILE_LIST

REVIEW ANGLE CATALOG (pick from these IDs):
  logic          — Logic & Correctness (off-by-one, wrong comparisons, broken invariants)
  spec-contract  — Spec vs. Implementation Contract (docstrings/comments vs. actual code behavior)
  security       — Security & Input Validation (injection, auth bypass, data exposure)
  edge-cases     — Edge Cases & Error Handling (missing error handling, resource leaks, boundaries)
  perf           — Performance & Scalability (N+1 queries, unbounded loops, missing caching)
  api-contract   — API Contract & Backwards Compatibility (breaking changes, response shape changes)
  data-integrity — Database & Data Integrity (schema safety, transaction boundaries, concurrent writes)
  concurrency    — Concurrency & Race Conditions (TOCTOU, missing locks, async pitfalls)
  types          — Type Safety & Type Correctness (unsafe assertions, generic gaps, serialization boundaries)
  ui-ux          — UI/UX & Accessibility (missing states, keyboard nav, a11y, responsive)
  config-deploy  — Configuration & Deployment (env vars, build scripts, secrets, rollback safety)
  test-coverage  — Test Coverage Gaps (untested new paths, stale tests, integration gaps)
  migration-safety — Migration & Schema Safety (downtime risk, data loss, rollback)

RULES:
1. Read the diff file to understand what changed
2. Select 4 angles by default (unless the diff is very large or spans many domains — then up to 6).
   The base fleet is now `logic` + `spec-contract` + 2 domain-specific angles.
3. `logic` and `spec-contract` are BOTH near-always relevant — include them together unless the
   change is purely config/styling with no prose claims to audit. They are the two mandatory
   angles; every other angle is picked on merit.
4. Prioritize angles where bugs are LIKELY given this specific diff, not just theoretically possible
5. Consider file types: .sql/.migration → data-integrity/migration-safety, .css/.tsx with JSX → ui-ux,
   routes/middleware → security, package.json/Dockerfile → config-deploy, etc.

OUTPUT FORMAT (strict — no other text):
ANGLES: id1, id2, id3
REASONING: one sentence per angle explaining why it's relevant to THIS diff
```

Use `model: "haiku"` for this agent. Parse the `ANGLES:` line to get the selected IDs.

If the user specified custom focus areas in their request, override the triage result:
- Map their request to catalog IDs where possible
- If they mention something not in the catalog, create an ad-hoc angle with a custom prompt
- Still limit to 3-5 angles unless the user explicitly asks for more


## Step 1.5: Fixture audit

Before asking the user to confirm angles, spawn one **haiku** subagent to audit the test
fixtures that cover the changed code. The goal is to surface suspicious fixture values that
could hide the exact bugs the fleet is about to look for. Test fixtures that neuter the
behavior under test are a silent failure mode — reviewers walk past bugs because the tests
"pass", but the tests pass only because the fixture made the failure path unreachable.

Spawn **one** subagent via the Agent tool with `model: "haiku"`. It must return a short,
structured list of findings that will be injected into every review agent's prompt in Step 3.

**Fixture-audit agent prompt:**
```
You are a test-fixture audit agent. Your job is to find suspicious fixture values in the
tests that cover the changed code — values that could silently hide bugs by making a filter,
guard, or boundary check effectively a no-op under test.

Diff file: $DIFF_FILE
Changed files:
$FILE_LIST

STEP 1: Identify the test files that cover the changed code. Look for:
  - Files matching `test_*`, `*_test.py`, `*.test.ts`, `*.spec.ts`, `__tests__/*`, `tests/*`
  - Tests whose imports reference the changed modules
  - Tests in the same directory tree as the changed files

STEP 2: For each relevant test file, scan for SUSPICIOUS FIXTURE VALUES in these categories:
  (a) Exchange/filter values effectively disabled:
      step_size <= 1e-6, min_notional = 0, min_qty = 0, tick_size = 0,
      max_position = inf, max_anything = sys.maxsize, price_precision = 0
  (b) Timeouts/windows shorter than production:
      retry counts of 0 or 1, windows of 0s, sleeps of 0, rate limits at 0 or very high,
      TTLs set to 0 or near-infinity
  (c) Permissive defaults that skip validation:
      empty allowlists/denylists, optional-everything configs, auth disabled,
      feature flags forced on/off to bypass branches
  (d) Single-item collections where production is N-many:
      one trading pair, one user, one tenant, one shard, one worker, one region
  (e) Mocks that remove behavior rather than simulate it:
      MagicMock() with no spec, mocks that return a constant for every call,
      mocks that swallow side effects (writes, network, logging) the code expects to fail on

STEP 3: Report findings. For each: the test file, the line, the fixture variable/argument,
the suspicious value, and what a realistic production value would be. Keep each finding to
one line; the list goes into every reviewer's prompt, so terseness matters.

OUTPUT FORMAT (strict — no other text):
FIXTURE_CAVEATS:
- <test_file>:<line> — <fixture name> = <value used in test>; production would see <realistic value>; hides: <what check this disables>
- ...
(If no suspicious fixtures, output exactly: FIXTURE_CAVEATS: NONE)

Do NOT editorialize. Do NOT list every fixture — only ones that could plausibly hide bugs
in the changed code.
```

Parse the agent's output and capture the `FIXTURE_CAVEATS:` block into a variable the main
skill can pass forward. Show the caveats in the Step 2 confirmation screen so the user can
see what will be fed to the fleet.

If the haiku returns `FIXTURE_CAVEATS: NONE`, carry an empty block forward and note
"Fixture audit: no suspicious values found" in the confirmation.


## Step 2: Ask for confirmation

Show the user what was selected, then ask for approval **using the `AskUserQuestion`
tool** (not a plain-text question). The structured tool call is what the user's
interface listens on to flag "agent waiting for input" — a prose question in the
chat stream will not fire that notification.

### 2a. Print the briefing as normal text first

Before the tool call, emit the briefing block below as regular assistant text so
the full context (angles, reasoning, scope notes, fixture caveats) is visible in
the transcript. `AskUserQuestion` options are length-limited and cannot carry
this much context on their own.

```
Fleet Review — Triage Complete

Based on your diff, these review angles were selected:

  REVIEW FLEET (parallel, N angles x 2 models):
    Claude 1 — [Selected Angle 1 name]
    Claude 2 — [Selected Angle 2 name]
    Claude 3 — [Selected Angle 3 name]
    Codex 1  — [Selected Angle 1 name]
    Codex 2  — [Selected Angle 2 name]
    Codex 3  — [Selected Angle 3 name]

  TRIAGE REASONING:
    - angle1: why it was selected
    - angle2: why it was selected
    - angle3: why it was selected

  SCOPE NOTES — what the fleet will (and won't) do by default:
    [For each selected angle that appears in the "Scope defaults & how to broaden"
     table, render one entry here using this format:]

    - <angle-id>
        Default: <Default scope column, verbatim>
        To broaden: <Broader scope column, verbatim>
        Example: <Example broadening phrase column, verbatim>

    [If none of the selected angles appear in the table, render:]
    (no scope ambiguity for the selected angles — catalog focus list is the full scope)

    You can include a broadening phrase via the "Adjust" option below (e.g.
    "add spec-contract broader: also check docs/SPEC.md and project_v7_live_deployment.md").
    It will be appended to that angle's reviewer prompt under a BROADENED SCOPE header.

  FIXTURE AUDIT (injected into every reviewer's prompt):
    - <test_file>:<line> — <caveat>
    - ...
    (or: no suspicious fixture values found)

  VERIFICATION (after fleet completes):
    Claude verifier — cross-checks all findings
    Codex verifier  — cross-checks all findings

  Base branch: $BASE
  Files changed: N
```

### 2b. Then invoke the AskUserQuestion tool

Call `AskUserQuestion` with one question and the three structured options below.
Keep `header` short (≤12 chars) and each option's `label` short (≤25 chars) so
the UI renders cleanly.

```
AskUserQuestion({
  questions: [
    {
      header: "Proceed?",
      question: "Proceed with this fleet review plan?",
      multiSelect: false,
      options: [
        {
          label: "Yes, proceed",
          description: "Launch the fleet exactly as listed above."
        },
        {
          label: "Adjust angles",
          description: "Add/drop/swap angles or add a broadening phrase before launch."
        },
        {
          label: "Cancel",
          description: "Stop the fleet review without spawning any agents."
        }
      ]
    }
  ]
})
```

### 2c. Branch on the answer

- **"Yes, proceed"** → continue to Step 3.
- **"Adjust angles"** → ask a free-form follow-up (this can be plain text, since the
  user already engaged) for the specific changes ("which angles to add/drop, and any
  broadening phrases?"), apply them, then re-run Step 2b to re-confirm.
- **"Cancel"** → stop, run Step 7 cleanup, do not spawn agents.

If `AskUserQuestion` is unavailable in the current session (tool not registered),
fall back to a plain-text "Proceed? (yes / no / adjust angles)" question and parse
the reply heuristically.


## Step 3: Launch the review fleet (all agents in parallel)

Launch all agents in a SINGLE response — do not wait for any to finish before launching
the others. The whole point is parallel, independent exploration.

For each selected angle, spawn one Claude subagent and one Codex agent (or two Claude
subagents if Codex is unavailable).

### Building the prompt for each angle

For each selected angle ID, construct the review prompt by pulling from the catalog above.
Every agent prompt follows this template:

```
Review the code changes in $DIFF_FILE against the source files in this repo.
Focus ONLY on [ANGLE NAME]:
[bullet list from the angle's "Prompt focus" section in the catalog]

Do NOT comment on style, naming, or issues outside your focus area.
Read the surrounding code — not just the diff — to understand the full context.

(Reasoning effort is already pinned to `xhigh` via the fleet-reviewer subagent
frontmatter — matching Codex's `model_reasoning_effort="xhigh"` tier on the API
side. Do NOT add `ultrathink` to the prompt; that's a separate in-prompt nudge
that doesn't change the effort tier, and mixing the two muddies the signal.)

TEST FIXTURE CAVEATS:
[paste the FIXTURE_CAVEATS block from Step 1.5 verbatim, or "NONE" if empty]

For every finding you consider, also ask: "does this code fail when the production
value is used instead of the fixture value above?" Any test that only passes because
a fixture defanged a production check is a suspect — flag the code path the fixture
hides, not the fixture itself.

For each finding, output this exact format:
FINDING:
  severity: P0|P1|P2|P3
  file: <path>
  line: <number or range>
  title: <one-line summary>
  detail: <2-3 sentences explaining the bug and why it matters>
  evidence: <the specific code pattern that's wrong>

If you find nothing, output: NO_FINDINGS

Severity guide:
  P0 = will cause data loss, crash, or security breach in production
  P1 = will cause incorrect behavior for some users
  P2 = could cause issues under specific conditions
  P3 = minor issue, unlikely to cause problems but worth noting
```

### Claude subagents (via Agent tool, all run_in_background: true)

Spawn one Agent per selected angle using `subagent_type: "oh-my-claudecode:fleet-reviewer"` AND an
explicit `model: "opus"` on the same spawn. Two knobs, two surfaces — set both:

- **Model — forced here, from the command.** Pass `model: "opus"` on every reviewer
  spawn. This is authoritative: it overrides whatever model the subagent frontmatter
  defaults to, and it is REQUIRED when the session model carries a `[1m]` suffix
  (subagents cannot inherit `[1m]`, so an explicit model must be supplied or the
  spawn will not resolve). Never leave model to the session default — that silently
  degrades the review whenever the session runs a weaker model.
- **Effort — carried by the subagent.** `subagent_type: "oh-my-claudecode:fleet-reviewer"` invokes
  this plugin's `agents/fleet-reviewer.md`, which pins `effort: xhigh` in its
  frontmatter — the only surface Claude Code exposes for per-subagent effort (the
  Agent/Task tool has no effort parameter; see anthropics/claude-code#25669).
  `xhigh` makes the Claude side match Codex's `model_reasoning_effort="xhigh"` tier
  exactly — one notch above `high`, one below `max`.

Pairing `model: "opus"` with the agent's `xhigh` keeps the Claude reviewers at full
flagship depth. If the resolved Opus model does not support `xhigh`, the effort
downgrades silently — flag that to the user in the confirmation step.

Each spawn should:
- Read the diff file
- Explore the actual source files (not just the diff) to understand context
- Report findings in the structured format defined above

Do NOT add "ultrathink" or similar keywords to the prompt. Those are in-prompt
nudges that operate orthogonally to effort tiers and do not change the API
effort level; mixing them muddies the signal. Frontmatter is the canonical knob.

### Codex agents (via Bash, all run_in_background: true)

For each selected angle, run a Codex process. Use `$CODEX_BIN` (resolved in
Step 0), close stdin explicitly so wrapper-detection codepaths can't hang,
and omit the deprecated `--enable web_search_cached` flag (web search is on
by default in codex v0.125+; the new override is `web_search` in
`config.toml`).

```bash
"$CODEX_BIN" exec "[condensed prompt for this angle, referencing $DIFF_FILE]" \
  -s read-only \
  -c 'model_reasoning_effort="xhigh"' \
  < /dev/null \
  2>/dev/null
```

Use `timeout: 900000` (15 minutes) on each Bash call. If a Codex job sits
at 0% CPU after ~2 minutes (`ps -o pcpu -p <pid>`) with an empty stdout
file, it is almost certainly a wrapper hang — kill it and rerun with a
hardcoded absolute path to the binary; do not retry the same invocation.

### Total agents

The base fleet now runs 4 angles (`logic` + `spec-contract` + 2 domain-specific) because
both `logic` and `spec-contract` are mandatory.

If 4 angles selected: 4 Claude + 4 Codex = 8 agents (default)
If 5 angles selected: 5 Claude + 5 Codex = 10 agents
If 6 angles selected: 6 Claude + 6 Codex = 12 agents

(Step 1.5's fixture-audit haiku is a separate one-shot agent that runs before this step,
not part of the parallel review fleet counter.)


## Step 4: Collect and parse findings

As each agent completes, parse its output for FINDING blocks. Collect all findings into
a single list. If an agent returned NO_FINDINGS, note that.

Create a consolidated findings document:

```
FLEET REVIEW — RAW FINDINGS
════════════════════════════════════════════════════════════
Base branch: $BASE
Files changed: N
Angles: [list selected angle names]
Agents completed: X/Y

[For each angle:]
CLAUDE ([Angle Name]): N findings
CODEX ([Angle Name]): N findings

TOTAL RAW FINDINGS: N
════════════════════════════════════════════════════════════

[list each finding with its source agent and angle]
```

Show this summary to the user before proceeding to verification.


## Step 5: Verification (cross-model)

If there are zero findings across all agents, skip verification and report clean.

If there ARE findings, run two verification agents — one Claude, one Codex.
Each verifier independently reviews every finding against the actual source code
and the diff.

### Claude verifier (Agent tool):

Invoke via `subagent_type: "oh-my-claudecode:fleet-verifier"` AND an explicit `model: "opus"` on the
spawn. Model is forced here from the command (authoritative, and required under a
`[1m]` session model so the spawn resolves); effort comes from the subagent. The
dedicated subagent at this plugin's `agents/fleet-verifier.md` has `effort: xhigh`
pinned in frontmatter,
matching the Codex verifier's `model_reasoning_effort="xhigh"` exactly. Do not
add "ultrathink" to the prompt; effort is set upstream.

```
You are a verification agent. Below are code review findings from a fleet of reviewers.
Your job is to independently verify each one by reading the actual source code.

For each finding:
1. Read the file and line referenced
2. Trace the logic to confirm or refute the claim
3. Verdict: CONFIRMED, REFUTED, or LIKELY (can't fully confirm but plausible)

Findings to verify:
[paste all findings]

Output format for each:
VERDICT:
  original_title: <title from finding>
  status: CONFIRMED|REFUTED|LIKELY
  confidence: HIGH|MEDIUM|LOW
  reasoning: <1-2 sentences explaining why you confirmed or refuted>
```

### Codex verifier (Bash):
```bash
"$CODEX_BIN" exec "You are a verification agent. These findings were reported by code reviewers. Read the actual source files and verify each one. For each: read the file/line, trace the logic, verdict: CONFIRMED/REFUTED/LIKELY with reasoning.

Findings:
[paste all findings]

Output format: VERDICT: original_title, status(CONFIRMED/REFUTED/LIKELY), confidence(HIGH/MEDIUM/LOW), reasoning" \
  -s read-only \
  -c 'model_reasoning_effort="xhigh"' \
  < /dev/null \
  2>/dev/null
```

Use `timeout: 900000` (15 minutes) on the Codex verifier.


## Step 6: Cross-reference and produce final report

Match up the two verifiers' verdicts for each finding:

- **Both CONFIRMED** -> HIGH confidence, include in final report
- **One CONFIRMED, one LIKELY** -> MEDIUM confidence, include with note
- **Both LIKELY** -> LOW confidence, include as "possible issue"
- **One CONFIRMED, one REFUTED** -> DISPUTED, include with both perspectives
- **Both REFUTED** -> Drop from final report (false positive)
- **One LIKELY, one REFUTED** -> Drop (probably false positive)

Present the final report:

```
FLEET REVIEW — FINAL REPORT
════════════════════════════════════════════════════════════
Base branch: $BASE | Files changed: N | Duration: Xm Ys
Review angles: [list selected angles with reasoning]

CONFIRMED FINDINGS (high confidence):
  [P0] Title — file:line
        Detail...
        Angle: [angle name] | Found by: Claude, Codex | Verified by: both

  [P1] Title — file:line
        Detail...
        Angle: [angle name] | Found by: Codex | Verified by: Claude + Codex(LIKELY)

POSSIBLE FINDINGS (lower confidence):
  [P2] Title — file:line
        Detail...
        Angle: [angle name] | Found by: Claude | Verified by: Claude(LIKELY), Codex(LIKELY)

DISPUTED:
  [P1] Title — file:line
        Claude verifier: CONFIRMED — reasoning
        Codex verifier: REFUTED — reasoning

STATS:
  Review angles:     N
  Total agents:      N review + 2 verification
  Raw findings:      N
  After verification: N confirmed, N possible, N disputed, N refuted
  False positive rate: X%
════════════════════════════════════════════════════════════
```


## Step 6.5: Persist findings for `/fleet-fix` handoff

The final report from Step 6 lives in conversation memory, which is exactly what the
user is about to discard with `/clear` so `/fleet-fix` can run on a clean context.
Write a structured copy to disk so the next session can pick it up without re-running
review.

### Location

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
FINDINGS_DIR="$REPO_ROOT/.fleet-review"
FINDINGS_FILE="$FINDINGS_DIR/findings.md"
mkdir -p "$FINDINGS_DIR"
```

Use the Write tool (not `cat <<EOF`) to emit `$FINDINGS_FILE`. The file must be
self-contained — `/fleet-fix` will read it from a fresh conversation with no other
context.

### File format

```markdown
# Fleet Review Findings

> Generated by /fleet-review on <ISO-8601 timestamp>.
> Base branch: <BASE> | Commit: <git rev-parse HEAD short SHA>
> Files changed: <N> | Angles: <comma-separated angle names>
> Consumed by: /fleet-fix (reads this file as primary input)

## Confirmed findings (high confidence)

### [P0] <title>
- **file:** `<path>`
- **line:** `<number or range>`
- **angle:** <angle name>
- **found by:** <Claude / Codex / both>
- **verified by:** <both / Claude+Codex(LIKELY)/ ...>
- **detail:** <2-3 sentence explanation>
- **evidence:**
  ```
  <the wrong code pattern>
  ```

### [P1] <title>
...

## Possible findings (lower confidence)

### [P2] <title>
...

## Disputed

### [P1] <title>
- **file:** `<path>` line `<n>`
- **Claude verifier:** CONFIRMED — <reasoning>
- **Codex verifier:** REFUTED — <reasoning>

## Stats

- Review angles: N
- Total agents: N review + 2 verification
- Raw findings: N
- After verification: N confirmed, N possible, N disputed, N refuted
- False positive rate: X%
```

Drop any "refuted" finding entirely — `/fleet-fix` should never see false positives.
Keep `file:` and `title:` per finding because `/fleet-fix`'s Input step requires
both fields to plan edits.

### Gitignore hint (one-shot)

If `.fleet-review/` is not already in `.gitignore`, append it:

```bash
if [ -f "$REPO_ROOT/.gitignore" ] && ! grep -qxF ".fleet-review/" "$REPO_ROOT/.gitignore"; then
  printf '\n# fleet-review handoff (consumed by /fleet-fix)\n.fleet-review/\n' >> "$REPO_ROOT/.gitignore"
fi
```

Don't create `.gitignore` if it doesn't already exist — that's a project-shape
decision for the user.

### Handoff message to the user

After writing the file, print this block as the LAST thing in your reply (after the
Step 6 final report). The user is going to read it, hit `/clear`, then run `/fleet-fix`,
so it must be the parting instruction:

```
─────────────────────────────────────────────
Findings saved → .fleet-review/findings.md
  N confirmed · N possible · N disputed

Next: clear this conversation, then run /fleet-fix to apply the fixes.
  1. /clear
  2. /fleet-fix

/fleet-fix will read .fleet-review/findings.md automatically as its input.
─────────────────────────────────────────────
```

Adjust the counts and skip lines that are zero (e.g. don't say "0 disputed").


## Step 7: Cleanup

```bash
rm -f "$DIFF_FILE"
```

Do **NOT** delete `$FINDINGS_FILE` — `/fleet-fix` reads it after a `/clear`. It is
the user's responsibility (or `/fleet-fix`'s) to clean it up after the fixes land.


## Fallback: Codex unavailable

If Codex CLI is not installed, run the pipeline with Claude subagents only — double the
fleet-reviewer spawns per angle. Both still use `subagent_type: "oh-my-claudecode:fleet-reviewer"`, so
the effort tier stays pinned at `xhigh` identically on both — do NOT downgrade one to get
"diversity", that just makes the second pass weaker. Diversity instead comes from varying
the prompt seed: give the two spawns for the same angle slightly different prompt framings
(e.g. one starts from the diff, one starts from the changed files' call sites) so they
build different mental models of the code. The verification stage becomes 2 fleet-verifier
spawns, same way.


## Important rules

- **Never modify code.** This skill is read-only. All agents run in read-only mode.
- **All reviewers launch in parallel.** Do not serialize them.
- **Triage first.** Always run the triage step to select angles — never hardcode angles.
- **Always ask confirmation first.** The user must approve the selected angles before agents spawn.
- **Present findings verbatim.** Show raw findings before verification, then the final report.
- **Respect timeouts.** 15 minutes per agent. If one times out, proceed with the others.
- **Clean up temp files.** Remove the diff file when done.
- **User overrides win.** If the user specifies angles, those override triage selection.
