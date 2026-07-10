#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
writeFileSync(join(root, 'codex/cachebuster.txt'), `local-${stamp}\n`);

for (const [command, args] of [
  [process.execPath, ['scripts/codex/build.mjs']],
  [process.execPath, ['scripts/codex/validate.mjs']],
  [process.execPath, ['scripts/codex/setup.mjs']],
]) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
}

if (process.env.CODEX_SYNC_SKIP_INSTALL !== '1') {
  execFileSync('codex', ['plugin', 'marketplace', 'add', root], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  execFileSync('codex', ['plugin', 'add', 'oh-my-claudecode@ohmycc-local'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}
console.log('Codex synchronization complete. Start a fresh Codex thread to load the refreshed plugin snapshot.');
