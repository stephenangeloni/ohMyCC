import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HANDOFF_DOC = 'docs/shared/verification-handoff.md';
// The verifier prompt loads at every spawn; the ledger format and long examples
// belong in the shared doc, so the prompt must stay close to its old size.
const VERIFIER_PROMPT_BUDGET_BYTES = 12 * 1024;

function read(relPath: string): string {
  const fullPath = join(REPO_ROOT, relPath);
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
}

function verificationBlock(content: string): string {
  return content.match(/<verification>([\s\S]*?)<\/verification>/)?.[1]?.trim() ?? '';
}

// Every file that routes work to the `verifier` agent. Sites that only name a
// different reviewer (ralph's architect/critic gate, autopilot Phase 4, the
// fleet-verifier agent) are deliberately absent.
const VERIFIER_CALLERS = [
  'agents/verifier.md',
  'docs/CLAUDE.md',
  'CLAUDE.md',
  '.github/CLAUDE.md',
  'skills/team/SKILL.md',
  'skills/omc-reference/SKILL.md',
  'src/hooks/keyword-detector/ultrawork/default.ts',
  'src/agents/definitions.ts',
  'docs/shared/workflow-gating.md',
  'docs/shared/agent-return-contract.md',
];

describe('shared verification handoff doc', () => {
  const doc = read(HANDOFF_DOC);

  it('exists next to agent-return-contract.md', () => {
    expect(existsSync(join(REPO_ROOT, HANDOFF_DOC))).toBe(true);
  });

  it('defines the four ledger parts with an example block', () => {
    expect(doc).toContain('## Prior checks ledger');
    for (const part of ['Artifacts:', 'Checks run', 'Not yet checked', 'Depth:']) {
      expect(doc).toContain(part);
    }
    expect(doc).toContain('| # | Claim | Command | Quoted result | Deterministic |');
    expect(doc).toContain('sha256');
    expect(doc).toContain('md5');
    expect(doc).toMatch(/commit SHA with a clean tree/i);
  });

  it('defines quick, standard and thorough, with standard as the ledger default', () => {
    for (const depth of ['`quick`', '`standard`', '`thorough`']) {
      expect(doc).toContain(`| ${depth} |`);
    }
    expect(doc).toContain('Default when a ledger is present');
    expect(doc).toContain('No prior checks ledger was given; full verification done.');
  });

  it('tells the caller to ask the user for a depth sized to the change', () => {
    expect(doc).toContain('AskUserQuestion');
    expect(doc).toContain('git diff --shortstat');
    expect(doc).toContain('(Recommended)');
    for (const label of ['"Skip"', '"Quick"', '"Standard', '"Thorough"']) {
      expect(doc).toContain(label);
    }
    expect(doc).toContain('Only the user can choose Skip');
    expect(doc).toContain('not independently verified');
  });

  it('describes the triage statuses and evidence sources', () => {
    for (const token of ['ACCEPTED', 'RE-RUN', 'REJECTED', 'LEDGER', 'NEW']) {
      expect(doc).toContain(token);
    }
  });
});

describe('verifier agent prompt: ledger triage', () => {
  const prompt = read('agents/verifier.md');

  it('points at the shared ledger format', () => {
    expect(prompt).toContain('Prior checks ledger');
    expect(prompt).toContain(HANDOFF_DOC);
  });

  it('checks artifact identity before trusting a ledger item', () => {
    expect(prompt).toMatch(/Identity first/);
    expect(prompt).toContain('A mismatch voids every ledger item on that artifact.');
  });

  it('never skips the adequacy review', () => {
    expect(prompt).toContain('the adequacy review is never skipped');
    expect(prompt).toContain('A check that only proves two texts agree does not prove behavior.');
    expect(prompt).toContain('A check narrower than its claim is a finding.');
  });

  it('accepts a ledger item without a new run only when every condition holds', () => {
    expect(prompt).toContain('Accept a ledger item without a new run only when ALL hold');
    for (const condition of ['identity matches', 'exact command', 'quoted result', 'deterministic', 'adequacy review passed']) {
      expect(prompt).toContain(condition);
    }
  });

  it('defines the three depths and only ever raises the caller depth', () => {
    expect(prompt).toContain('- quick:');
    expect(prompt).toContain('- standard:');
    expect(prompt).toContain('- thorough:');
    expect(prompt).toContain('spot check');
    expect(prompt).toContain('Never lower the depth the caller asked for.');
  });

  it('keeps full verification when no ledger is given and says so', () => {
    expect(prompt).toContain('No prior checks ledger was given; full verification done.');
  });

  it('reports ledger triage and the source of each piece of evidence', () => {
    expect(prompt).toContain('### Ledger triage');
    expect(prompt).toContain('ACCEPTED / RE-RUN / REJECTED');
    expect(prompt).toContain('| Source |');
    expect(prompt).toContain('LEDGER / RE-RUN / NEW');
  });

  it('keeps trust-without-evidence and adds redundant re-verification as failure modes', () => {
    expect(prompt).toContain('Trust without evidence');
    expect(prompt).toContain(
      'Redundant re-verification: a new run of a check that an accepted ledger item already covers, with no stated reason.',
    );
  });

  it('drops the rules that forced every check to run again', () => {
    expect(prompt).not.toContain('Run verification commands yourself. Do not trust claims without output.');
    expect(prompt).not.toContain('Did I run verification commands myself');
    expect(prompt).not.toMatch(/Stale evidence:[^\n]*Run fresh\./);
  });

  it('keeps the verdict sentinel and vocabulary unchanged', () => {
    expect(prompt).toContain('OMC-VERDICT: verifier | <PASS|FAIL|INCOMPLETE> | <one-line bottom line>');
    expect(prompt).toContain('**Status**: PASS | FAIL | INCOMPLETE');
    expect(prompt).toContain('APPROVE | REQUEST_CHANGES | NEEDS_MORE_EVIDENCE');
  });

  it('stays compact: the ledger format lives only in the shared doc', () => {
    expect(prompt).not.toContain('| # | Claim | Command | Quoted result | Deterministic |');
    expect(Buffer.byteLength(prompt, 'utf-8')).toBeLessThan(VERIFIER_PROMPT_BUDGET_BYTES);
  });
});

describe('verifier callers', () => {
  it.each(VERIFIER_CALLERS)('%s references the shared handoff doc', (file) => {
    expect(read(file)).toContain(HANDOFF_DOC);
  });

  it('CLAUDE.md template asks for a depth, then hands off a ledger', () => {
    const block = verificationBlock(read('docs/CLAUDE.md'));
    expect(block).toContain('When you delegate to `verifier`, pass a Prior checks ledger');
    expect(block).toContain('with a depth');
    expect(block).toContain('Ask the user for that depth first');
    expect(block).toContain('not independently verified');
  });

  it('keeps the <verification> block identical in all three CLAUDE.md copies', () => {
    const template = verificationBlock(read('docs/CLAUDE.md'));
    expect(verificationBlock(read('CLAUDE.md'))).toBe(template);
    expect(verificationBlock(read('.github/CLAUDE.md'))).toBe(template);
  });

  it('team-verify asks for the depth once per run and hands the verifier a ledger', () => {
    const team = read('skills/team/SKILL.md');
    expect(team).toContain('Prior checks ledger');
    expect(team).toMatch(/before the first `team-verify`/);
    expect(team).toContain('reuses the answer');
  });
});

describe('triage vocabulary stays strict', () => {
  // A verifier once labelled an item it never ran "RE-RUN (not re-executed)".
  const RERUN_RULE =
    'RE-RUN means you ran it. A non-deterministic item you do not run is REJECTED; cover its claim with a narrower deterministic check, or list it as a gap.';

  it('the verifier prompt reserves RE-RUN for items it ran', () => {
    expect(read('agents/verifier.md')).toContain(RERUN_RULE);
  });

  it('the shared doc states the same rule', () => {
    expect(read(HANDOFF_DOC)).toContain(RERUN_RULE);
  });
});
