/**
 * Tests for CLAUDE.md backup helpers
 * Covers same-second uniqueness and bounded pruning of CLAUDE.md.backup.* files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildClaudeMdBackupFilename, pruneClaudeMdBackups } from '../index.js';

describe('buildClaudeMdBackupFilename', () => {
  it('produces distinct filenames for two backups requested in the same whole second', () => {
    const date = new Date('2026-06-03T12:34:56.000Z');

    const first = buildClaudeMdBackupFilename(date, []);
    const second = buildClaudeMdBackupFilename(date, [first]);

    expect(first).toMatch(/^CLAUDE\.md\.backup\./);
    expect(second).toMatch(/^CLAUDE\.md\.backup\./);
    expect(second).not.toBe(first);
  });

  it('keeps incrementing past further same-second collisions', () => {
    const date = new Date('2026-06-03T12:34:56.000Z');
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      names.push(buildClaudeMdBackupFilename(date, names));
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('pruneClaudeMdBackups', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'omc-claude-md-backup-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps only the newest N backups and removes older ones', () => {
    // Lexicographic order of these names matches chronological order.
    const names = [
      'CLAUDE.md.backup.2026-06-03T12-00-00',
      'CLAUDE.md.backup.2026-06-03T12-00-01',
      'CLAUDE.md.backup.2026-06-03T12-00-02',
      'CLAUDE.md.backup.2026-06-03T12-00-03',
      'CLAUDE.md.backup.2026-06-03T12-00-04',
      'CLAUDE.md.backup.2026-06-03T12-00-05',
      'CLAUDE.md.backup.2026-06-03T12-00-06',
    ];
    for (const name of names) {
      writeFileSync(join(tempDir, name), 'x');
    }
    // Unrelated file must never be touched.
    writeFileSync(join(tempDir, 'CLAUDE.md'), 'live');

    pruneClaudeMdBackups(tempDir, 5);

    const remaining = readdirSync(tempDir).filter(f => f.startsWith('CLAUDE.md.backup.')).sort();
    expect(remaining).toEqual(names.slice(-5));
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(true);
  });

  it('is a no-op when backups are at or below the keep count', () => {
    const names = [
      'CLAUDE.md.backup.2026-06-03T12-00-00',
      'CLAUDE.md.backup.2026-06-03T12-00-01',
    ];
    for (const name of names) {
      writeFileSync(join(tempDir, name), 'x');
    }

    pruneClaudeMdBackups(tempDir, 5);

    const remaining = readdirSync(tempDir).filter(f => f.startsWith('CLAUDE.md.backup.')).sort();
    expect(remaining).toEqual(names);
  });
});
