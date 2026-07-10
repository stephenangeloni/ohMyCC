#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commandAliases, nativeSkills, publishedSkillName } from './catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, ['scripts/codex/build.mjs', '--check'], { cwd: root, stdio: 'inherit' });

const pluginRoot = join(root, 'codex');
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
const allowed = new Set(['name', 'version', 'description', 'author', 'skills', 'mcpServers', 'interface']);
for (const key of Object.keys(manifest)) {
  if (!allowed.has(key)) throw new Error(`Unsupported Codex plugin field: ${key}`);
}
for (const companion of [manifest.skills, manifest.mcpServers]) {
  if (!existsSync(resolve(pluginRoot, companion))) throw new Error(`Missing plugin companion: ${companion}`);
}

const classifications = JSON.parse(readFileSync(join(root, 'codex/skill-classification.json'), 'utf8'));
const sourceSkills = readdirSync(join(root, 'skills'))
  .filter((name) => existsSync(join(root, 'skills', name, 'SKILL.md')))
  .sort();
if (JSON.stringify(classifications.map((entry) => entry.name).sort()) !== JSON.stringify(sourceSkills)) {
  throw new Error('Codex skill classification does not cover every bundled Claude skill exactly once.');
}
if (classifications.some((entry) => !['portable', 'adapted'].includes(entry.status))) {
  throw new Error('Every bundled skill must have a usable Codex portable or adapted implementation.');
}

const generatedAliases = JSON.parse(readFileSync(join(root, 'codex/command-aliases.json'), 'utf8'));
const sourceCommands = readdirSync(join(root, 'commands'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => name.slice(0, -3))
  .sort();
if (JSON.stringify(Object.keys(generatedAliases).sort()) !== JSON.stringify(sourceCommands)) {
  throw new Error('Codex command aliases do not cover every Claude command exactly once.');
}
for (const [command, target] of commandAliases) {
  const expected = publishedSkillName(target);
  if (generatedAliases[command] !== expected) throw new Error(`Unexpected Codex alias for ${command}.`);
  if (!existsSync(join(root, 'codex/skills', expected, 'SKILL.md'))) {
    throw new Error(`Codex command ${command} targets missing skill ${expected}.`);
  }
}

const forbidden = /Task\(|AskUserQuestion|TodoWrite|\/oh-my-claudecode:|\$CLAUDE_PLUGIN_ROOT|CLAUDE_CONFIG_DIR|subagent_type/;
for (const name of readdirSync(join(root, 'codex/skills'))) {
  const path = join(root, 'codex/skills', name, 'SKILL.md');
  const content = readFileSync(path, 'utf8');
  if (statSync(path).isFile() && forbidden.test(content)) {
    throw new Error(`Generated Codex skill contains unsupported Claude construct: ${name}`);
  }
  if (!content.startsWith(`---\nname: ${name}\n`)) throw new Error(`Generated skill name does not match its directory: ${name}`);
}
for (const sourceName of nativeSkills.keys()) {
  const publishedName = publishedSkillName(sourceName);
  if (!existsSync(join(root, 'codex/skills', publishedName, 'SKILL.md'))) {
    throw new Error(`Missing published Codex skill for source ${sourceName}: ${publishedName}`);
  }
}

const skillValidator = join(process.env.HOME ?? '', '.codex/skills/.system/skill-creator/scripts/quick_validate.py');
if (existsSync(skillValidator)) {
  for (const name of readdirSync(join(root, 'codex/skills')).sort()) {
    execFileSync('python3', [skillValidator, join(root, 'codex/skills', name)], { stdio: 'pipe' });
  }
} else console.warn(`Skill validator not found at ${skillValidator}; local structural validation completed.`);

const validator = join(process.env.HOME ?? '', '.codex/skills/.system/plugin-creator/scripts/validate_plugin.py');
if (existsSync(validator)) execFileSync('python3', [validator, pluginRoot], { stdio: 'inherit' });
else console.warn(`Plugin validator not found at ${validator}; local structural validation completed.`);

const generatedSkillCount = readdirSync(join(root, 'codex/skills')).length;
console.log(`Validated ${generatedSkillCount} Codex skills, ${classifications.length} Claude skill adapters, ${sourceCommands.length} command aliases, and plugin assets.`);
