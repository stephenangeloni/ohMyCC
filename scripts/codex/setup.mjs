#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const agentsTarget = join(codexHome, 'agents');
const start = '<!-- OMC:CODEX:START -->';
const end = '<!-- OMC:CODEX:END -->';
const managedGuidance = readFileSync(join(root, 'codex/AGENTS.managed.md'), 'utf8').trim();
const hookAdapter = join(root, 'scripts/codex/hook-adapter.mjs');
const managedCommand = `node "${hookAdapter.replaceAll('"', '\\"')}"`;
const supportedEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop'];
const removeManaged = process.argv.includes('--remove');

function managedBlockPattern() {
  return new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
}

function stripManagedBlock(content) {
  const stripped = content.replace(managedBlockPattern(), '').trimEnd();
  return stripped ? `${stripped}\n` : '';
}

function replaceManagedBlock(content, body) {
  const block = `${start}\n${body.trim()}\n${end}`;
  const stripped = stripManagedBlock(content).trimEnd();
  return `${stripped}${stripped ? '\n\n' : ''}${block}\n`;
}

function containsManagedHook(entry) {
  return Array.isArray(entry?.hooks) && entry.hooks.some((hook) => typeof hook?.command === 'string' && hook.command.includes(hookAdapter));
}

mkdirSync(codexHome, { recursive: true });
mkdirSync(agentsTarget, { recursive: true });
if (removeManaged) {
  for (const file of readdirSync(agentsTarget).filter((name) => name.startsWith('omc-') && name.endsWith('.toml'))) {
    rmSync(join(agentsTarget, file));
  }
} else {
  for (const file of readdirSync(join(root, 'codex/agents')).filter((name) => name.endsWith('.toml'))) {
    cpSync(join(root, 'codex/agents', file), join(agentsTarget, file));
  }
}

const agentsPath = join(codexHome, 'AGENTS.md');
const existingGuidance = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
writeFileSync(agentsPath, removeManaged ? stripManagedBlock(existingGuidance) : replaceManagedBlock(existingGuidance, managedGuidance));

const hooksPath = join(codexHome, 'hooks.json');
const preservedHookStatePath = join(codexHome, 'hooks-state.omc-preserved.json');
let hooksDocument = { hooks: {} };
if (existsSync(hooksPath)) {
  try { hooksDocument = JSON.parse(readFileSync(hooksPath, 'utf8')); } catch { throw new Error(`Invalid JSON in ${hooksPath}`); }
}
if (!hooksDocument.hooks || typeof hooksDocument.hooks !== 'object' || Array.isArray(hooksDocument.hooks)) hooksDocument.hooks = {};
if (hooksDocument.state && typeof hooksDocument.state === 'object' && !Array.isArray(hooksDocument.state)) {
  let preservedState = {};
  if (existsSync(preservedHookStatePath)) {
    try { preservedState = JSON.parse(readFileSync(preservedHookStatePath, 'utf8')); } catch { throw new Error(`Invalid JSON in ${preservedHookStatePath}`); }
  }
  writeFileSync(preservedHookStatePath, `${JSON.stringify({ ...preservedState, ...hooksDocument.state }, null, 2)}\n`);
  delete hooksDocument.state;
}
for (const event of supportedEvents) {
  const existing = Array.isArray(hooksDocument.hooks[event]) ? hooksDocument.hooks[event].filter((entry) => !containsManagedHook(entry)) : [];
  if (removeManaged) {
    if (existing.length > 0) hooksDocument.hooks[event] = existing;
    else delete hooksDocument.hooks[event];
    continue;
  }
  const managed = { hooks: [{ type: 'command', command: managedCommand, ...(event === 'Stop' ? { timeout: 30 } : {}) }] };
  if (event === 'SessionStart') managed.matcher = 'startup|resume|clear';
  if (event === 'PreToolUse') managed.matcher = 'Bash';
  hooksDocument.hooks[event] = [...existing, managed];
}
writeFileSync(hooksPath, `${JSON.stringify(hooksDocument, null, 2)}\n`);

console.log(
  removeManaged
    ? `Removed managed Codex agents, guidance, and hooks from ${codexHome}.`
    : `Synchronized Codex agents, guidance, and ${supportedEvents.length} supported hook events in ${codexHome}.`,
);
