---
name: ultraqa
description: QA cycling workflow - test, verify, fix, repeat until goal met
argument-hint: "[--workflow] [--tests|--build|--lint|--typecheck|--custom <pattern>] [--interactive]"
level: 3
---

# UltraQA Skill

[ULTRAQA ACTIVATED - AUTONOMOUS QA CYCLING]

## Overview

You are now in **ULTRAQA** mode - an autonomous QA cycling workflow that runs until your quality goal is met.

**Cycle**: qa-tester → architect verification → fix → repeat

## Relationship to `/goal`, Ralph, Team, and Ultragoal

UltraQA owns repeated quality-gate cycling only. Use the deterministic conflict policies `refuse`, `adopt_existing`, and `artifact_only` rather than non-deterministic warning handling. Use it after the target behavior is known and the remaining question is whether tests, build, lint, typecheck, or another explicit QA condition passes. If Claude Code `/goal` is active, UltraQA may produce visible command evidence for that goal, but must not describe the `/goal` evaluator as independently running commands or reading files. If Ralph or Team is active, UltraQA is a verification/fix sub-loop under that authority rather than a competing session loop. If no active loop is safe, record QA expectations and evidence in artifact-only Ultragoal notes instead of claiming automatic execution.

## Goal Parsing

Parse the goal from arguments. Supported formats:

| Invocation                                     | Goal Type | What to Check                    |
| ---------------------------------------------- | --------- | -------------------------------- |
| `/oh-my-claudecode:ultraqa --tests`            | tests     | All test suites pass             |
| `/oh-my-claudecode:ultraqa --build`            | build     | Build succeeds with exit 0       |
| `/oh-my-claudecode:ultraqa --lint`             | lint      | No lint errors                   |
| `/oh-my-claudecode:ultraqa --typecheck`        | typecheck | No TypeScript errors             |
| `/oh-my-claudecode:ultraqa --custom "pattern"` | custom    | Custom success pattern in output |

If no structured goal provided, interpret the argument as a custom goal.

## Cycle Workflow

### Cycle N (Max 5)

1. **RUN QA**: Execute verification based on goal type
   - `--tests`: Run the project's test command
   - `--build`: Run the project's build command
   - `--lint`: Run the project's lint command
   - `--typecheck`: Run the project's type check command
   - `--custom`: Run appropriate command and check for pattern
   - `--interactive`: Use qa-tester for interactive CLI/service testing:
     ```
     Task(subagent_type="oh-my-claudecode:qa-tester", model="sonnet", prompt="TEST:
     Goal: [describe what to verify]
     Service: [how to start]
     Test cases: [specific scenarios to verify]
     End with your OMC-VERDICT sentinel: OMC-VERDICT: qa-tester | <PASS|FAIL|BLOCKED> | <summary>")
     ```

2. **CHECK RESULT**: Did the goal pass?
   - For the `--interactive` (qa-tester) path, read the verdict from qa-tester's `OMC-VERDICT: qa-tester | …` sentinel (per `docs/shared/agent-return-contract.md`) — do NOT eyeball the multi-case report. A missing/empty sentinel is UNKNOWN, not pass — recover from the task output file or re-dispatch. For command-based goals (`--tests`/`--build`/…), read the command's own exit code.
   - **PASS** → Exit with success message
   - **FAIL / BLOCKED** (or command non-zero exit) → Continue to step 3

3. **ARCHITECT DIAGNOSIS**: Spawn architect to analyze failure

   ```
   Task(subagent_type="oh-my-claudecode:architect", model="opus", prompt="DIAGNOSE FAILURE:
   Goal: [goal type]
   Output: [test/build output]
   Provide root cause and specific fix recommendations.")
   ```

4. **FIX ISSUES**: Apply architect's recommendations

   ```
   Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="FIX:
   Issue: [architect diagnosis]
   Files: [affected files]
   Apply the fix precisely as recommended.")
   ```

5. **REPEAT**: Go back to step 1

### Cycle Workflow (workflow variant)

Take this path **only when** the run is opted in (`--workflow` flag or "use a workflow") **AND** a
background Workflow is available **AND** this is a multi-cycle QA run on a non-trivial change
(hard floor: trivial single-file fixes verified inline stay on the default path). If any condition
fails — no opt-in, no Workflow capability, or trivial change — **fall back to the default cycle
above** and note the fallback in one line. Never hard-fail.

This is architecturally mandated by the gating policy (no hard fail when a primitive is absent)
per `docs/shared/workflow-gating.md`.

When taken, the win is loop **determinism**: the script owns the cycle counter and same-error
detection, so the model cannot declare done early. Since UltraQA already offloads to
`.omc/ultraqa-state.json`, this replaces prose-managed counters with a real counter in script:

```js
export const meta = {
  name: 'ultraqa',
  description: 'QA cycle loop until goal met — script owns the counter',
  phases: [{ title: 'QA Cycle' }, { title: 'Fix' }],
}
const MAX = 5, goal = args.goal_type, cmd = args.qa_cmd
let lastErr = null, sameCount = 0
for (let cycle = 1; cycle <= MAX; cycle++) {
  const result = await agent(`RUN QA: goal=${goal} cmd=${cmd} cycle=${cycle}`,
    { phase: 'QA Cycle', label: `cycle:${cycle}` })
  if (result.passed) return { status: 'complete', cycles: cycle }
  if (result.error === lastErr) { if (++sameCount >= 3) return { status: 'same-error', error: lastErr } }
  else { lastErr = result.error; sameCount = 1 }
  await agent(`FIX: ${result.diagnosis}`, { phase: 'Fix', label: `fix:${cycle}`,
    agentType: 'oh-my-claudecode:executor' })
}
return { status: 'max-cycles', last_error: lastErr }
```

## Exit Conditions

| Condition             | Action                                                                        |
| --------------------- | ----------------------------------------------------------------------------- |
| **Goal Met**          | Exit with success: "ULTRAQA COMPLETE: Goal met after N cycles"                |
| **Cycle 5 Reached**   | Exit with diagnosis: "ULTRAQA STOPPED: Max cycles. Diagnosis: ..."            |
| **Same Failure 3x**   | Exit early: "ULTRAQA STOPPED: Same failure detected 3 times. Root cause: ..." |
| **Environment Error** | Exit: "ULTRAQA ERROR: [tmux/port/dependency issue]"                           |

## Observability

Output progress each cycle:

```
[ULTRAQA Cycle 1/5] Running tests...
[ULTRAQA Cycle 1/5] FAILED - 3 tests failing
[ULTRAQA Cycle 1/5] Architect diagnosing...
[ULTRAQA Cycle 1/5] Fixing: auth.test.ts - missing mock
[ULTRAQA Cycle 2/5] Running tests...
[ULTRAQA Cycle 2/5] PASSED - All 47 tests pass
[ULTRAQA COMPLETE] Goal met after 2 cycles
```

## State Tracking

Track state in `.omc/ultraqa-state.json`:

```json
{
  "active": true,
  "goal_type": "tests",
  "goal_pattern": null,
  "cycle": 1,
  "max_cycles": 5,
  "failures": ["3 tests failing: auth.test.ts"],
  "started_at": "2024-01-18T12:00:00Z",
  "session_id": "uuid"
}
```

## Cancellation

User can cancel with `/oh-my-claudecode:cancel` which clears the state file.

## Important Rules

1. **PARALLEL when possible** - Run diagnosis while preparing potential fixes
2. **TRACK failures** - Record each failure to detect patterns
3. **EARLY EXIT on pattern** - 3x same failure = stop and surface
4. **CLEAR OUTPUT** - User should always know current cycle and status
5. **CLEAN UP** - Clear state file on completion or cancellation

## STATE CLEANUP ON COMPLETION

**IMPORTANT: Delete state files on completion - do NOT just set `active: false`**

When goal is met OR max cycles reached OR exiting early:

```bash
# Delete ultraqa state file
rm -f .omc/state/ultraqa-state.json
```

This ensures clean state for future sessions. Stale state files with `active: false` should not be left behind.

---

Begin ULTRAQA cycling now. Parse the goal and start cycle 1.

## Configuration

- `--workflow` (or "use a workflow") opts this run into the background Dynamic Workflow variant
  when available and the change is non-trivial; `direct:` / `--no-workflow` forces the default
  in-context cycle. Default path unchanged. Policy: `docs/shared/workflow-gating.md`.
