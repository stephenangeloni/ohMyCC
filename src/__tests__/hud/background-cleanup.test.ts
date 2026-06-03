import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hud/state.js', () => ({
  readHudState: vi.fn(),
  writeHudState: vi.fn(() => true),
}));

import {
  cleanupStaleBackgroundTasks,
  detectOrphanedTasks,
  markOrphanedTasksAsStale,
} from '../../hud/background-cleanup.js';
import { readHudState, writeHudState } from '../../hud/state.js';

const mockReadHudState = vi.mocked(readHudState);
const mockWriteHudState = vi.mocked(writeHudState);

describe('background-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteHudState.mockReturnValue(true);
  });

  describe('cleanupStaleBackgroundTasks', () => {
    it('marks stale running tasks as failed instead of silently removing them', async () => {
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'stale-running',
            description: 'Stale running task',
            startedAt: staleTime,
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];

      const staleTask = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'stale-running'
      );
      expect(staleTask).toBeDefined();
      expect(staleTask!.status).toBe('failed');
      expect(staleTask!.completedAt).toBeDefined();
    });

    it('updates state.timestamp when writing state', async () => {
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const oldTimestamp = '2020-01-01T00:00:00.000Z';
      mockReadHudState.mockReturnValue({
        timestamp: oldTimestamp,
        backgroundTasks: [
          {
            id: 'stale-task',
            description: 'Stale task',
            startedAt: staleTime,
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];
      expect(writtenState.timestamp).not.toBe(oldTimestamp);
      expect(new Date(writtenState.timestamp).getTime()).toBeGreaterThan(
        new Date(oldTimestamp).getTime()
      );
    });

    it('does not write state when recent running tasks are unchanged', async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'recent-running',
            description: 'Recent running task',
            startedAt: recentTime,
            status: 'running',
          },
        ],
      });

      const result = await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('does not write state when only completed tasks exist', async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'completed-task',
            description: 'Done task',
            startedAt: recentTime,
            status: 'completed',
            completedAt: recentTime,
          },
        ],
      });

      const result = await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('returns 0 when no state exists', async () => {
      mockReadHudState.mockReturnValue(null);
      const result = await cleanupStaleBackgroundTasks();
      expect(result).toBe(0);
      expect(mockWriteHudState).not.toHaveBeenCalled();
    });

    it('returns 0 when backgroundTasks is undefined', async () => {
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: undefined as unknown as [],
      });
      const result = await cleanupStaleBackgroundTasks();
      expect(result).toBe(0);
      expect(mockWriteHudState).not.toHaveBeenCalled();
    });

    it('handles mix of stale running and completed tasks', async () => {
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'stale-running',
            description: 'Stale running',
            startedAt: staleTime,
            status: 'running',
          },
          {
            id: 'recent-completed',
            description: 'Recent completed',
            startedAt: recentTime,
            status: 'completed',
            completedAt: recentTime,
          },
          {
            id: 'recent-running',
            description: 'Recent running',
            startedAt: recentTime,
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];

      const staleTask = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'stale-running'
      );
      expect(staleTask).toBeDefined();
      expect(staleTask!.status).toBe('failed');
      expect(staleTask!.completedAt).toBeDefined();

      const completedTask = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'recent-completed'
      );
      expect(completedTask).toBeDefined();
      expect(completedTask!.status).toBe('completed');

      const recentRunning = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'recent-running'
      );
      expect(recentRunning).toBeDefined();
      expect(recentRunning!.status).toBe('running');
    });

    it('uses strict > comparison (task within threshold stays running)', async () => {
      const threshold = 30 * 60 * 1000;
      // Use threshold - 100ms to avoid race between test setup and function execution
      const withinThreshold = new Date(Date.now() - threshold + 100).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'boundary-task',
            description: 'Boundary task',
            startedAt: withinThreshold,
            status: 'running',
          },
        ],
      });

      const result = await cleanupStaleBackgroundTasks(threshold);

      // Task within threshold should NOT be marked failed (strict >)
      expect(mockWriteHudState).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('marks task as failed when just past threshold', async () => {
      const threshold = 30 * 60 * 1000;
      const justPast = new Date(Date.now() - threshold - 1).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'just-past',
            description: 'Just past threshold',
            startedAt: justPast,
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(threshold);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];
      const task = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'just-past'
      );
      expect(task!.status).toBe('failed');
    });

    it('treats legacy startTime alias as startedAt', async () => {
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'legacy-task',
            description: 'Legacy task',
            startedAt: undefined as unknown as string,
            startTime: staleTime,
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];
      const task = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'legacy-task'
      );
      expect(task).toBeDefined();
      expect(task!.status).toBe('failed');
      expect(task!.completedAt).toBeDefined();
    });

    it('marks running task as failed when startedAt is invalid (NaN)', async () => {
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          {
            id: 'bad-timestamp',
            description: 'Invalid timestamp task',
            startedAt: 'not-a-date',
            status: 'running',
          },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];
      const task = writtenState.backgroundTasks.find(
        (t: { id: string }) => t.id === 'bad-timestamp'
      );
      expect(task).toBeDefined();
      expect(task!.status).toBe('failed');
      expect(task!.completedAt).toBeDefined();
    });

    it('preserves running tasks when limiting history to 20', async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const tasks = [];

      // 19 completed tasks
      for (let i = 0; i < 19; i++) {
        tasks.push({
          id: `completed-${i}`,
          description: `Completed ${i}`,
          startedAt: recentTime,
          status: 'completed' as const,
          completedAt: recentTime,
        });
      }

      // 3 running tasks (total 22 > 20)
      for (let i = 0; i < 3; i++) {
        tasks.push({
          id: `running-${i}`,
          description: `Running ${i}`,
          startedAt: recentTime,
          status: 'running' as const,
        });
      }

      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: tasks,
      });

      // Add one stale task to trigger a write
      tasks.push({
        id: 'stale-trigger',
        description: 'Stale',
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        status: 'running' as const,
      });

      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [...tasks],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const writtenState = mockWriteHudState.mock.calls[0][0];

      // All 3 recent running tasks must be preserved
      const runningTasks = writtenState.backgroundTasks.filter(
        (t: { status: string }) => t.status === 'running'
      );
      expect(runningTasks).toHaveLength(3);

      // Total should be capped at 20
      expect(writtenState.backgroundTasks.length).toBeLessThanOrEqual(20);
    });

    it('handles empty backgroundTasks array', async () => {
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [],
      });

      const result = await cleanupStaleBackgroundTasks();

      expect(result).toBe(0);
      expect(mockWriteHudState).not.toHaveBeenCalled();
    });
  });

  describe('markOrphanedTasksAsStale', () => {
    it('sets completedAt when marking an orphan so it can be reaped (P1)', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'orphan', description: 'Orphaned', startedAt: threeHoursAgo, status: 'running' },
        ],
      });

      const marked = await markOrphanedTasksAsStale();

      expect(marked).toBe(1);
      expect(mockWriteHudState).toHaveBeenCalledTimes(1);
      const written = mockWriteHudState.mock.calls[0][0];
      const task = written.backgroundTasks.find((t: { id: string }) => t.id === 'orphan');
      expect(task!.status).toBe('completed');
      // Regression guard: without completedAt, cleanupStaleBackgroundTasks keeps the task
      // forever (the reaper only expires completed tasks that have a completedAt).
      expect(task!.completedAt).toBeDefined();
    });

    it('reads HUD state only once — no redundant re-read (P2)', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'orphan', description: 'Orphaned', startedAt: threeHoursAgo, status: 'running' },
        ],
      });

      await markOrphanedTasksAsStale();

      expect(mockReadHudState).toHaveBeenCalledTimes(1);
    });

    it('an orphan it marks is later reaped once its completedAt passes the threshold', async () => {
      // State as it would look AFTER markOrphaned wrote it, with completedAt now stale.
      const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'orphan', description: 'Orphaned', startedAt: old, status: 'completed', completedAt: old },
        ],
      });

      await cleanupStaleBackgroundTasks(30 * 60 * 1000);

      const written = mockWriteHudState.mock.calls[0][0];
      expect(
        written.backgroundTasks.find((t: { id: string }) => t.id === 'orphan')
      ).toBeUndefined();
    });
  });

  describe('detectOrphanedTasks', () => {
    it('flags a long-running task as orphaned', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'orphan', description: 'Orphaned', startedAt: threeHoursAgo, status: 'running' },
        ],
      });

      const orphaned = await detectOrphanedTasks();

      expect(orphaned.map(t => t.id)).toContain('orphan');
    });

    it('flags a running task with an invalid startedAt as orphaned instead of skipping it (P2 NaN-safety)', async () => {
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'bad', description: 'Invalid start', startedAt: 'not-a-date', status: 'running' },
        ],
      });

      const orphaned = await detectOrphanedTasks();

      expect(orphaned.map(t => t.id)).toContain('bad');
    });

    it('does not flag a recently-started running task', async () => {
      const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockReadHudState.mockReturnValue({
        timestamp: new Date().toISOString(),
        backgroundTasks: [
          { id: 'recent', description: 'Recent', startedAt: recent, status: 'running' },
        ],
      });

      const orphaned = await detectOrphanedTasks();

      expect(orphaned).toHaveLength(0);
    });
  });
});
