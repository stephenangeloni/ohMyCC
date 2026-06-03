/**
 * OMC HUD - Background Task Cleanup
 *
 * Handles cleanup of stale and orphaned background tasks on HUD startup.
 */

import type { BackgroundTask } from './types.js';
import { readHudState, writeHudState } from './state.js';

const STALE_TASK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes default

/**
 * Parse task start time safely, handling both `startedAt` and legacy `startTime` alias.
 * Returns NaN when neither field contains a valid timestamp.
 */
function getTaskStartMs(task: BackgroundTask): number {
  const raw = task.startedAt ?? task.startTime;
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

/**
 * Clean up stale background tasks from HUD state.
 * Removes tasks that are old and not recently completed.
 *
 * @param thresholdMs Age threshold in milliseconds (default: 30 minutes)
 * @returns Number of tasks removed
 */
export async function cleanupStaleBackgroundTasks(
  thresholdMs: number = STALE_TASK_THRESHOLD_MS,
  directory?: string,
  sessionId?: string
): Promise<number> {
  const state = readHudState(directory, sessionId);

  if (!state || !state.backgroundTasks) {
    return 0;
  }

  const now = Date.now();
  const originalCount = state.backgroundTasks.length;
  let statusChanged = false;

  // Mark stale running tasks as failed before filtering (consistent with cleanupTasks()
  // in background-tasks.ts) — prevents silently dropping running tasks
  for (const task of state.backgroundTasks) {
    if (task.status === 'running') {
      const startMs = getTaskStartMs(task);
      if (Number.isNaN(startMs)) {
        // Unparseable timestamp — treat as stale to avoid silent data loss
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        statusChanged = true;
      } else {
        const taskAge = now - startMs;
        if (taskAge > thresholdMs) {
          task.status = 'failed';
          task.completedAt = new Date().toISOString();
          statusChanged = true;
        }
      }
    }
  }

  // Filter out expired completed/failed tasks (consistent with cleanupTasks()
  // in background-tasks.ts: running tasks always kept, completed/failed expire
  // based on completedAt)
  state.backgroundTasks = state.backgroundTasks.filter(task => {
    // Running tasks always kept (stale ones were already marked failed above)
    if (task.status === 'running') return true;

    // For completed/failed, expire based on completedAt
    if (task.completedAt) {
      const completedMs = new Date(task.completedAt).getTime();
      if (Number.isNaN(completedMs)) return true;
      return now - completedMs < thresholdMs;
    }

    return true;
  });

  // Limit history to 20 most recent — preserve running tasks (consistent with
  // cleanupTasks() in background-tasks.ts)
  if (state.backgroundTasks.length > 20) {
    const running = state.backgroundTasks.filter(t => t.status === 'running');
    const nonRunning = state.backgroundTasks
      .filter(t => t.status !== 'running')
      .slice(-Math.max(0, 20 - running.length));
    state.backgroundTasks = [...running, ...nonRunning];
  }

  const removedCount = originalCount - state.backgroundTasks.length;

  if (removedCount > 0 || statusChanged) {
    state.timestamp = new Date().toISOString();
    writeHudState(state, directory, sessionId);
  }

  return removedCount;
}

const ORPHANED_TASK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours — likely a crashed session

/**
 * Find running tasks that look orphaned (from a previous crashed session) within an
 * already-loaded task list. Pure — no I/O — so callers that already hold state need not
 * re-read it.
 *
 * A running task whose start timestamp is missing/unparseable is treated as orphaned
 * (consistent with cleanupStaleBackgroundTasks treating NaN starts as stale) rather than
 * silently skipped — `NaN > threshold` is always false, which previously let such tasks slip
 * through detection.
 */
function findOrphanedTasks(tasks: BackgroundTask[], now: number = Date.now()): BackgroundTask[] {
  const orphaned: BackgroundTask[] = [];
  for (const task of tasks) {
    if (task.status !== 'running') continue;
    const startMs = getTaskStartMs(task);
    if (Number.isNaN(startMs) || now - startMs > ORPHANED_TASK_THRESHOLD_MS) {
      orphaned.push(task);
    }
  }
  return orphaned;
}

/**
 * Detect orphaned background tasks that are still marked as running
 * but are likely from a previous session crash.
 *
 * @returns Array of orphaned tasks
 */
export async function detectOrphanedTasks(
  directory?: string,
  sessionId?: string,
): Promise<BackgroundTask[]> {
  const state = readHudState(directory, sessionId);

  if (!state || !state.backgroundTasks) {
    return [];
  }

  return findOrphanedTasks(state.backgroundTasks);
}

/**
 * Mark orphaned tasks as completed to clear them from the active display.
 *
 * Sets `completedAt` alongside the status so cleanupStaleBackgroundTasks can later expire
 * them — without it, an orphan marked 'completed' has no `completedAt` and the reaper
 * (which only expires completed/failed tasks that have a `completedAt`) keeps it forever.
 *
 * @returns Number of tasks marked
 */
export async function markOrphanedTasksAsStale(
  directory?: string,
  sessionId?: string,
): Promise<number> {
  const state = readHudState(directory, sessionId);

  if (!state || !state.backgroundTasks) {
    return 0;
  }

  // Operate on the already-loaded state. Do NOT call detectOrphanedTasks here — it would
  // read the state file a second time (redundant I/O plus a TOCTOU window between reads).
  // The returned tasks are references into state.backgroundTasks, so mutating them updates
  // the state we are about to write.
  const orphaned = findOrphanedTasks(state.backgroundTasks);
  for (const task of orphaned) {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
  }

  if (orphaned.length > 0) {
    writeHudState(state, directory, sessionId);
  }

  return orphaned.length;
}
