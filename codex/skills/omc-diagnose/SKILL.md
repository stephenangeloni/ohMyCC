---
name: omc-diagnose
description: "Diagnose hard application bugs behind a tight, red-capable feedback loop."
---

# Diagnose

Build a tight feedback loop before forming any theory: one fast, deterministic, agent-runnable command that goes red on this exact bug and that you have already run at least once, pasting the invocation and its output. Reading code to build a hypothesis before that command exists is the failure this skill prevents. For flaky bugs raise the reproduction rate until it is debuggable rather than chasing a clean repro; when no loop can be built, say so explicitly and ask for an environment, a captured artifact, or permission to instrument.

Reproduce, then minimise to the smallest scenario that still goes red, cutting one element at a time until every remaining element is load-bearing. Generate three to five ranked falsifiable hypotheses before testing any, each stating its prediction, and show the ranking to the user before probing. Escalate to the trace skill when hypotheses genuinely compete on tangled evidence.

Instrument one variable at a time, preferring a debugger over targeted logs and never logging everything to grep it. Tag every debug log with a unique prefix such as `[DEBUG-a4f2]` so cleanup is a single grep. For performance regressions establish a baseline measurement first, then bisect. Write the regression test before the fix, but only at a seam that exercises the real bug pattern at the call site; where no correct seam exists, record that absence as the finding. Before declaring done, re-run the loop, confirm the tagged instrumentation is gone, run the project checks, and state the winning hypothesis in the commit message.
