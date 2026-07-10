#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adaptedSkills,
  agentCatalog,
  codexOnlySkills,
  commandAliases,
  compatibilitySkills,
  nativeSkills,
  portableSkills,
  publishedSkillName,
  renderAgent,
  renderSkill,
} from './catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const cachebuster = readFileSync(join(root, 'codex/cachebuster.txt'), 'utf8').trim();

const sourceSkills = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, 'skills', entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

const catalogSkills = [...nativeSkills.keys()].filter((name) => !codexOnlySkills.has(name)).sort();
if (JSON.stringify(sourceSkills) !== JSON.stringify(catalogSkills)) {
  throw new Error('The Codex native skill catalog must cover every Claude source skill exactly once.');
}

const sourceCommands = readdirSync(join(root, 'commands'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name.slice(0, -3))
  .sort();
const catalogCommands = [...commandAliases.keys()].sort();
if (JSON.stringify(sourceCommands) !== JSON.stringify(catalogCommands)) {
  throw new Error('The Codex command alias catalog must cover every Claude command exactly once.');
}
for (const [command, target] of commandAliases) {
  if (!nativeSkills.has(target)) throw new Error(`Command ${command} maps to unknown skill ${target}.`);
}

const classifications = sourceSkills.map((name) => {
  if (portableSkills.has(name)) return { name, status: 'portable', reason: portableSkills.get(name) };
  return { name, status: 'adapted', reason: adaptedSkills.get(name) };
});

const outputs = new Map();
outputs.set('codex/skill-classification.json', `${JSON.stringify(classifications, null, 2)}\n`);

for (const name of [...compatibilitySkills].sort()) {
  outputs.set(`codex/skills/${name}/SKILL.md`, renderSkill(name, nativeSkills.get(name).description, name));
}
for (const [sourceName, skill] of [...nativeSkills].sort(([a], [b]) => a.localeCompare(b))) {
  const publishedName = publishedSkillName(sourceName);
  outputs.set(`codex/skills/${publishedName}/SKILL.md`, renderSkill(publishedName, skill.description, sourceName));
}
outputs.set('codex/command-aliases.json', `${JSON.stringify(
  Object.fromEntries([...commandAliases].map(([command, target]) => [command, publishedSkillName(target)])),
  null,
  2,
)}\n`);
for (const agent of agentCatalog) {
  const content = renderAgent(agent);
  outputs.set(`codex/agents/omc-${agent[0]}.toml`, content);
  outputs.set(`.codex/agents/omc-${agent[0]}.toml`, content);
}

outputs.set('.agents/plugins/marketplace.json', `${JSON.stringify({
  name: 'ohmycc-local',
  interface: { displayName: 'ohMyCC Local' },
  plugins: [{
    name: 'oh-my-claudecode',
    source: { source: 'local', path: './codex' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Developer Tools',
  }],
}, null, 2)}\n`);

const pluginManifest = `${JSON.stringify({
  name: 'oh-my-claudecode',
  version: `1.0.0+codex.${cachebuster}`,
  description: 'Personal OMC orchestration skills and standard MCP tools for Codex',
  author: { name: 'Stephen Angeloni' },
  skills: './skills/',
  mcpServers: './.mcp.json',
  interface: {
    displayName: 'ohMyCC',
    shortDescription: 'Personal OMC harness for Codex.',
    longDescription: 'The complete namespaced OMC skill and command catalog plus the standard OMC MCP tool server. Native agents, guidance, and hooks are synchronized by pnpm codex:setup.',
    developerName: 'Stephen Angeloni',
    category: 'Developer Tools',
    capabilities: ['Tools', 'Workflows'],
    defaultPrompt: [
      'Use $omc-verify to validate the current work.',
      'Use $omc-ralplan to create a consensus implementation plan.',
    ],
  },
}, null, 2)}\n`;
outputs.set('codex/.codex-plugin/plugin.json', pluginManifest);
outputs.set('.codex-plugin/plugin.json', pluginManifest);

outputs.set('codex/.mcp.json', `${JSON.stringify({
  mcpServers: {
    omc: { command: 'node', args: ['mcp-server.cjs'], cwd: '.' },
  },
}, null, 2)}\n`);
outputs.set('codex/mcp-server.cjs', readFileSync(join(root, 'bridge/mcp-server.cjs'), 'utf8'));

function current(path) {
  try { return readFileSync(join(root, path), 'utf8'); } catch { return null; }
}

if (check) {
  const drift = [...outputs].filter(([path, content]) => current(path) !== content).map(([path]) => path);
  if (drift.length > 0) {
    console.error(`Codex generated assets are stale:\n${drift.map((path) => `- ${path}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Codex generated assets are current (${outputs.size} files).`);
  process.exit(0);
}

for (const directory of ['codex/skills', 'codex/agents', '.codex/agents']) {
  rmSync(join(root, directory), { recursive: true, force: true });
}
for (const [path, content] of outputs) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}
console.log(`Generated ${outputs.size} Codex assets.`);
