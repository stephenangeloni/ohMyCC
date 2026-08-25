import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'session-start.mjs');
const NODE = process.execPath;

/**
 * A handoff body the notice must never surface. HANDOFF.MD is designed to be read
 * exactly once, in full, by the pickup-handoff skill and then deleted; SessionStart
 * only reports that one is waiting.
 */
const HANDOFF_BODY = [
  '> **On arrival — delete this file before doing anything else.**',
  '',
  '# Handoff — canary',
  '',
  '## Read now (required for the next action)',
  '- `src/canary.ts` — SENTINEL_HANDOFF_BODY',
  '',
  '## Continuation branch',
  '- Branch: `feat/canary`',
  '',
].join('\n');

function runHook(cwd: string, fakeHome: string): string {
  const raw = execFileSync(NODE, [SCRIPT_PATH], {
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 'session-handoff-notice',
      cwd,
    }),
    encoding: 'utf-8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
    timeout: 15000,
  }).trim();

  const output = JSON.parse(raw) as { hookSpecificOutput?: { additionalContext?: string } };
  return output.hookSpecificOutput?.additionalContext || '';
}

describe('session-start.mjs handoff notice', () => {
  let tempDir: string;
  let fakeHome: string;
  let fakeProject: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'omc-session-start-handoff-'));
    fakeHome = join(tempDir, 'home');
    fakeProject = join(tempDir, 'project');
    mkdirSync(join(fakeProject, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('announces a waiting handoff without injecting any of its contents', () => {
    const handoffPath = join(fakeProject, 'HANDOFF.MD');
    writeFileSync(handoffPath, HANDOFF_BODY);

    const context = runHook(fakeProject, fakeHome);

    expect(context).toContain('[HANDOFF WAITING]');
    expect(context).toContain(handoffPath);

    // Metadata only. A partial body here would leave the fresh session holding a lossy
    // fragment of a file whose entire contract is whole-or-nothing.
    expect(context).not.toContain('SENTINEL_HANDOFF_BODY');
    expect(context).not.toContain('feat/canary');
    expect(context).not.toContain('Read now');
  });

  it('leaves the handoff on disk for the pickup skill to read and delete', () => {
    const handoffPath = join(fakeProject, 'HANDOFF.MD');
    writeFileSync(handoffPath, HANDOFF_BODY);

    runHook(fakeProject, fakeHome);

    expect(readFileSync(handoffPath, 'utf-8')).toBe(HANDOFF_BODY);
  });

  it('notices a handoff at the worktree root from a nested working directory', () => {
    writeFileSync(join(fakeProject, 'HANDOFF.MD'), HANDOFF_BODY);
    const nested = join(fakeProject, 'src', 'features', 'deep');
    mkdirSync(nested, { recursive: true });

    expect(runHook(nested, fakeHome)).toContain('[HANDOFF WAITING]');
  });

  it('directs the session to the pickup skill rather than resuming on its own', () => {
    writeFileSync(join(fakeProject, 'HANDOFF.MD'), HANDOFF_BODY);

    const context = runHook(fakeProject, fakeHome);

    expect(context).toContain('Do not read it or act on it now');
    expect(context).toContain('pickup-handoff skill');
    expect(context).toContain("serve the user's newest request");
  });

  it('stays silent when no handoff is waiting', () => {
    expect(runHook(fakeProject, fakeHome)).not.toContain('[HANDOFF WAITING]');
  });

  it('stays silent outside a repository', () => {
    const loose = join(tempDir, 'loose');
    mkdirSync(loose, { recursive: true });

    expect(runHook(loose, fakeHome)).not.toContain('[HANDOFF WAITING]');
  });
});
