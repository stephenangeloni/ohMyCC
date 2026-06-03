import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import type { DispatchOutcome } from '../mcp-comm.js';

// Mock mcp-comm so queueDirectMailboxMessage returns a valid DispatchOutcome
// WITHOUT ever invoking the injected sendDirectMessage dep. This reproduces the
// fragile contract path: the send-message op's local `message` stays null, yet
// the dispatch "succeeds" at the transport level. The op MUST NOT surface that
// as { ok: true, data: { message: null } }.
vi.mock('../mcp-comm.js', async () => {
  const actual = await vi.importActual<typeof import('../mcp-comm.js')>('../mcp-comm.js');
  return {
    ...actual,
    queueDirectMailboxMessage: async (): Promise<DispatchOutcome> => ({
      ok: true,
      transport: 'hook',
      reason: 'duplicate_pending_dispatch_request',
      request_id: 'req-test',
      message_id: 'msg-test',
      to_worker: 'worker-1',
    }),
  };
});

// Imported after the mock declaration so the mocked module is used.
const { executeTeamApiOperation } = await import('../api-interop.js');

describe('team api send-message null-message guard', () => {
  let cwd: string;
  const teamName = 'null-guard-team';

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'omc-team-api-null-guard-'));
    const base = join(cwd, '.omc', 'state', 'team', teamName);
    await mkdir(join(base, 'tasks'), { recursive: true });
    await mkdir(join(base, 'mailbox'), { recursive: true });
    await mkdir(join(base, 'events'), { recursive: true });
    await writeFile(join(base, 'config.json'), JSON.stringify({
      name: teamName,
      task: 'null-guard',
      agent_type: 'executor',
      worker_count: 1,
      max_workers: 20,
      tmux_session: 'null-guard-session',
      workers: [{ name: 'worker-1', index: 1, role: 'executor', assigned_tasks: [] }],
      created_at: '2026-03-06T00:00:00.000Z',
      next_task_id: 2,
    }, null, 2));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('does not return { ok: true, data: { message: null } } when dispatch yields no message', async () => {
    const result = await executeTeamApiOperation('send-message', {
      team_name: teamName,
      from_worker: 'leader-fixed',
      to_worker: 'worker-1',
      body: 'Please continue',
    }, cwd);

    // The contract: a successful envelope must carry a non-null message. A null
    // message is a false success that 10+ dependents would read as delivered.
    if (result.ok) {
      expect((result.data as { message?: unknown }).message).not.toBeNull();
    } else {
      // Acceptable alternative: a structured error envelope.
      expect(result.error.code).toBeTruthy();
    }
  });
});
