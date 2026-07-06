# Agent Return Contract

Canonical spec for how OMC subagents return work to their caller, and how
orchestrators must consume it. This is the single source of truth for the
`OMC-VERDICT:` sentinel vocabulary — the per-agent `<Return_Contract>` blocks
reference this file so the vocabulary cannot drift across agent definitions.

## The problem this prevents

A subagent's caller receives **only the agent's final message**. Tool-call
outputs, intermediate assistant text, and extended-thinking blocks are all
stripped before delivery — the caller never sees them. Two failure modes follow
from ignoring that:

- **Failure A — emission.** The agent does its real work in tool calls and
  thinking, then signs off with a pleasantry ("analysis complete", "looks
  sound", "done, see above"). The substance is never emitted, so the caller
  receives an empty deliverable. Deictic references ("as shown above") point at
  content the caller cannot see.
- **Failure B — capture.** Even when an agent emits perfectly, a background /
  async agent's captured `<result>` is sometimes a *trailing no-op*, because the
  runtime re-pings the agent after its summary and captures that later, empty
  turn. This is a harness capture bug, unfixable by prompt wording. See the
  `background-agent-result-trailing-noop` project memory and `skills/cpr/SKILL.md`
  (Step 4 recovery).

The contract below defends against A (prompt discipline) and B (a stable,
greppable sentinel the caller can recover from the transcript output file).

## Rules every advisory agent follows

1. The FINAL message IS the return value — self-contained, no "above"/"as
   analyzed" references, nothing the caller needs left in thinking or tool output.
2. Reasoning may live in thinking, but the CONCLUSION is restated in the visible
   final message.
3. The deliverable is the last thing emitted — no trailing tool call or sign-off.
4. An explicit caller-supplied return format overrides the agent's default
   `<Output_Format>`.
5. The **literal last line** is an `OMC-VERDICT:` sentinel (below) for prose /
   default returns. **Exception:** when the caller requires a strict machine
   format — JSON, or exact file content it will `parse`/persist verbatim — the
   sentinel is **omitted** (a trailing line would corrupt the payload); the
   caller owns result capture in that case.

## Sentinel format

```
OMC-VERDICT: <agent> | <STATUS> | <one-line bottom line>
```

- Fields are separated by ` | ` (space-pipe-space).
- `<agent>` is the agent's own name (e.g. `architect`).
- `<STATUS>` is exactly one token from that agent's vocabulary (table below).
- `<one-line bottom line>` is a single-line human summary — no newlines.
- **Omitted** when the caller requires strict JSON or exact file content — a
  trailing line would break their `parse`/persist. This is the only case where
  the sentinel is absent by design; there, the caller validates the parsed
  payload's own success signal instead.
- Recover it from a task output file with:
  `grep -oE 'OMC-VERDICT:[^\n]*' <output_file> | tail -1`

## Per-agent STATUS vocabulary

Statuses reuse each agent's existing native verdict words where one exists; the
read-only / prose agents (`explore`, `document-specialist`, `qa-tester`,
`scientist`, `debugger`) get a purpose-fit vocabulary because they had none. The
**pass** column is what an orchestrator treats as "proceed".

| Agent             | STATUS tokens                                         | Pass (proceed) tokens              |
|-------------------|-------------------------------------------------------|------------------------------------|
| architect         | `SOUND` \| `CONCERNS` \| `BLOCKED`                     | `SOUND`                            |
| critic            | `ACCEPT` \| `ACCEPT-WITH-RESERVATIONS` \| `REVISE` \| `REJECT` | `ACCEPT`, `ACCEPT-WITH-RESERVATIONS` |
| analyst           | `READY` \| `GAPS`                                     | `READY`                            |
| planner           | `PLAN-READY` \| `NEEDS-INPUT`                          | `PLAN-READY`                        |
| code-reviewer     | `APPROVE` \| `REQUEST-CHANGES` \| `COMMENT`           | `APPROVE`, `COMMENT`                |
| security-reviewer | `PASS` \| `FINDINGS` \| `CRITICAL`                     | `PASS`                             |
| verifier          | `PASS` \| `FAIL` \| `INCOMPLETE`                       | `PASS`                             |
| tracer            | `ROOT-CAUSE` \| `HYPOTHESES-OPEN`                      | `ROOT-CAUSE`                        |
| explore           | `FOUND` \| `PARTIAL` \| `NONE`                         | `FOUND` (`PARTIAL` = usable, incomplete) |
| document-specialist | `ANSWERED` \| `PARTIAL` \| `NOT-FOUND`               | `ANSWERED`                          |
| qa-tester         | `PASS` \| `FAIL` \| `BLOCKED`                          | `PASS`                             |
| scientist         | `VERIFIED` \| `CONFLICTS` \| `INCONCLUSIVE`            | `VERIFIED`                          |
| debugger          | `ROOT-CAUSE` \| `HYPOTHESIS` \| `UNRESOLVED`           | `ROOT-CAUSE`                        |

`code-reviewer` uses `REQUEST-CHANGES` (hyphenated) in the sentinel even though
its prose verdict reads `REQUEST CHANGES`, so the token stays parseable.
`security-reviewer`: `PASS` = no security issues, `FINDINGS` = issues but none
critical/high-exploitable, `CRITICAL` = at least one critical/high exploitable
finding.

## How orchestrators MUST consume a verdict

This is the gate that stops a phantom pass:

1. Parse the verdict from the `OMC-VERDICT:` sentinel line — do NOT fuzzy-match a
   status word anywhere in the prose (`I do NOT APPROVE` must not read as pass).
   Test the parsed STATUS against **that agent's pass-set** (the "Pass" column
   above), never a single hard-coded token — vocabularies differ per agent, so
   `status === 'APPROVE'` passes for `code-reviewer` yet silently fails
   `architect` (`SOUND`), `security-reviewer` (`PASS`), and `critic` (`ACCEPT`).
2. If the returned message has **no sentinel** or is an empty acknowledgment,
   the verdict is **UNKNOWN, not pass**. Recover it: grep the sentinel from the
   agent's task output file. If still absent, **re-dispatch a fresh agent** with
   the return contract restated.
3. Never infer a verdict from silence, and never accept a secondhand assurance
   ("someone said it was fine") as the agent's verdict. Absence of a readable
   deliverable is a failure to recover from, never a pass to record.

Consumers today: `skills/plan/SKILL.md` (consensus), `skills/autopilot/SKILL.md`
(Phase 1 + Phase 4), `skills/ralph/SKILL.md` (reviewer gate),
`skills/ralplan/SKILL.md`, `skills/ultraqa/SKILL.md` (qa-tester),
`skills/sciomc/SKILL.md` (scientist), `skills/external-context/SKILL.md` (facet
check). Any new orchestrator that gates on an advisory agent's verdict must
follow the same protocol.
