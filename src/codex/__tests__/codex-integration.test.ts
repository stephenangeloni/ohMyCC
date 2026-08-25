import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporaryDirectories: string[] = [];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function treeHash(root: string): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(root);
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path.slice(root.length));
    digest.update(readFileSync(path));
  }
  return digest.digest('hex');
}

function tempHome(): string {
  const path = mkdtempSync(join(tmpdir(), 'ohmycc-codex-'));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  temporaryDirectories.length = 0;
});

describe('Codex plugin assets', () => {
  it('preserves the immutable Claude integration baselines', () => {
    expect(sha256(join(repoRoot, '.claude-plugin/marketplace.json'))).toBe(
      '950b7bb7fe86bdc67cc418a85b6b60145b8a50e3caf42b91561fe4b659e21400',
    );
    expect(sha256(join(repoRoot, '.claude-plugin/plugin.json'))).toBe(
      '5fa296f7a360d693b1cd8f049fbc7becf14edd4ec31b5921ae942215d0481fb9',
    );
    expect(sha256(join(repoRoot, 'hooks/hooks.json'))).toBe(
      '1fe65870803ef83b2b230f2f5b48532084d858b4f0653ab8144cc84ddeaac990',
    );
    expect(sha256(join(repoRoot, 'CLAUDE.md'))).toBe(
      '745406d04ed491e14b56e8d150171adad72678f6bc60c3e5399edd1b07a9d9ad',
    );
    expect(treeHash(join(repoRoot, 'commands'))).toBe(
      'b948e58686ff20b9cd7cb87dd2429f9f90bc1c485cb0046bcc98dc5d4f0f8726',
    );
  });

  it('resolves the repository marketplace plugin source to this checkout', () => {
    const marketplacePath = join(repoRoot, '.agents/plugins/marketplace.json');
    const marketplace = readJson<{
      name: string;
      plugins: Array<{ name: string; source: { source: string; path: string } }>;
    }>(marketplacePath);
    const plugin = marketplace.plugins.find((entry) => entry.name === 'oh-my-claudecode');

    expect(marketplace.name).toBe('ohmycc-local');
    expect(plugin?.source.source).toBe('local');
    expect(resolve(repoRoot, plugin!.source.path)).toBe(join(repoRoot, 'codex'));
  });

  it('declares only supported Codex plugin fields and existing companions', () => {
    const pluginRoot = join(repoRoot, 'codex');
    const manifest = readJson<Record<string, unknown>>(join(pluginRoot, '.codex-plugin/plugin.json'));
    expect(Object.keys(manifest).sort()).toEqual(
      ['author', 'description', 'interface', 'mcpServers', 'name', 'skills', 'version'].sort(),
    );
    expect(manifest.name).toBe('oh-my-claudecode');
    expect(statSync(resolve(pluginRoot, String(manifest.skills))).isDirectory()).toBe(true);
    expect(statSync(resolve(pluginRoot, String(manifest.mcpServers))).isFile()).toBe(true);
    expect(statSync(join(repoRoot, '.codex-plugin/plugin.json')).isFile()).toBe(true);
  });

  it('classifies every bundled Claude skill and emits Codex-safe generated skills', () => {
    const sourceSkills = readdirSync(join(repoRoot, 'skills'))
      .filter((name) => statSync(join(repoRoot, 'skills', name)).isDirectory())
      .filter((name) => statSync(join(repoRoot, 'skills', name, 'SKILL.md'), { throwIfNoEntry: false } as never)?.isFile())
      .sort();
    const classifications = readJson<Array<{ name: string; status: string }>>(
      join(repoRoot, 'codex/skill-classification.json'),
    );
    expect(classifications.map((entry) => entry.name).sort()).toEqual(sourceSkills);
    expect(new Set(classifications.map((entry) => entry.status))).toEqual(new Set(['portable', 'adapted']));

    const forbidden = /Task\(|AskUserQuestion|TodoWrite|\/oh-my-claudecode:|\$CLAUDE_PLUGIN_ROOT|CLAUDE_CONFIG_DIR|subagent_type/;
    const generated = readdirSync(join(repoRoot, 'codex/skills'));
    expect(generated.length).toBeGreaterThanOrEqual(2);
    for (const name of generated) {
      expect(readFileSync(join(repoRoot, 'codex/skills', name, 'SKILL.md'), 'utf8')).not.toMatch(forbidden);
    }
    expect(readFileSync(join(repoRoot, 'codex/skills/ralplan/SKILL.md'), 'utf8')).toContain(
      'native subagents',
    );
    expect(readFileSync(join(repoRoot, 'codex/skills/omc-ralplan/SKILL.md'), 'utf8')).toContain(
      'omc-planner',
    );

    for (const contextHandoffPath of [
      'codex/skills/context-handoff/SKILL.md',
      'codex/skills/omc-context-handoff/SKILL.md',
    ]) {
      const contextHandoff = readFileSync(join(repoRoot, contextHandoffPath), 'utf8');
      expect(contextHandoff).toContain('git branch --show-current');
      expect(contextHandoff).toContain('git switch -c');
      expect(contextHandoff).toContain('context-matching branch');
      expect(contextHandoff).toContain('must not continue development on `main`');
      expect(contextHandoff).toContain('single-use');
      expect(contextHandoff).toContain('delete it immediately');
      expect(contextHandoff).toContain('reads the whole file up front');
    }

    for (const pickupPath of [
      'codex/skills/pickup-handoff/SKILL.md',
      'codex/skills/omc-pickup-handoff/SKILL.md',
    ]) {
      const pickup = readFileSync(join(repoRoot, pickupPath), 'utf8');
      // Whole-file read then delete: a ranged read would silently drop file-map rows.
      expect(pickup).toContain('Read the entire file in one read');
      expect(pickup).toContain('a partial read makes that deletion silently lossy');
      expect(pickup).toContain('rm -f');
      expect(pickup).toContain('immediately after reading and before reporting');
      // Receipt, then stop.
      expect(pickup).toContain('it is not a summary');
      expect(pickup).toContain('stop and ask whether to proceed');
      // Same resume contract the handoff's own prompt carries.
      expect(pickup).toContain('never continue development on `main`');
      expect(pickup).toContain('write the file back verbatim from context');
      expect(pickup).toContain('Never write a new handoff when the resumed work finishes');
    }

    const alignmentSkill = readFileSync(
      join(repoRoot, 'codex/skills/omc-agents-claude-align/SKILL.md'),
      'utf8',
    );
    expect(sourceSkills).not.toContain('agents-claude-align');
    expect(classifications.map((entry) => entry.name)).not.toContain('agents-claude-align');
    expect(alignmentSkill).toContain('read-only audit');
    expect(alignmentSkill).toContain('hierarchical');
    expect(alignmentSkill).toContain('create `AGENTS.md`');
    expect(alignmentSkill).toContain('Claude-only');
    expect(alignmentSkill).toContain('Codex-specific');
    expect(alignmentSkill).toContain('ask whether to keep or remove');

    for (const sourceSkill of sourceSkills) {
      const namespaced = sourceSkill === 'setup'
        ? 'omc-setup-router'
        : sourceSkill.startsWith('omc-') ? sourceSkill : `omc-${sourceSkill}`;
      const path = join(repoRoot, 'codex/skills', namespaced, 'SKILL.md');
      expect(statSync(path).isFile(), `${sourceSkill} must generate ${namespaced}`).toBe(true);
      expect(readFileSync(path, 'utf8')).toMatch(new RegExp(`^---\\nname: ${namespaced}\\n`, 'm'));
    }
  });

  it('maps every Claude command to a globally discoverable namespaced skill', () => {
    const sourceCommands = readdirSync(join(repoRoot, 'commands'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort();
    const aliases = readJson<Record<string, string>>(join(repoRoot, 'codex/command-aliases.json'));

    expect(Object.keys(aliases).sort()).toEqual(sourceCommands);
    for (const command of sourceCommands) {
      expect(aliases[command]).toMatch(/^omc-[a-z0-9-]+$/);
      expect(statSync(join(repoRoot, 'codex/skills', aliases[command], 'SKILL.md')).isFile()).toBe(true);
    }
    expect(aliases.psm).toBe('omc-project-session-manager');
    expect(aliases.learner).toBe('omc-skillify');
  });

  it('generates deterministic skills and native agent TOML', () => {
    execFileSync(process.execPath, ['scripts/codex/build.mjs', '--check'], { cwd: repoRoot });
    const agents = readdirSync(join(repoRoot, 'codex/agents')).filter((name) => name.endsWith('.toml'));
    expect(agents.length).toBeGreaterThanOrEqual(6);
    for (const agent of agents) {
      const content = readFileSync(join(repoRoot, 'codex/agents', agent), 'utf8');
      expect(content).toMatch(/^name = "[a-z0-9-]+"/m);
      expect(content).toMatch(/^description = ".+"/m);
      expect(content).toMatch(/^developer_instructions = """[\s\S]+"""/m);
      expect(content).not.toMatch(/\b(haiku|sonnet|opus)\b|Task\(|AskUserQuestion|TodoWrite/);
    }
  });

  it('repairs marketplace registration before reinstalling during synchronization', () => {
    const sync = readFileSync(join(repoRoot, 'scripts/codex/sync.mjs'), 'utf8');
    const marketplaceAdd = sync.indexOf("['plugin', 'marketplace', 'add', root]");
    const pluginAdd = sync.indexOf("['plugin', 'add', 'oh-my-claudecode@ohmycc-local']");

    expect(marketplaceAdd).toBeGreaterThan(-1);
    expect(pluginAdd).toBeGreaterThan(marketplaceAdd);
  });
});

describe('Codex personal setup', () => {
  it('preserves unrelated config, hooks, guidance, and Claude files across repeated setup', () => {
    const home = tempHome();
    const codexHome = join(home, '.codex');
    const claudeHome = join(home, '.claude');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), 'model = "user-model"\n[custom]\nanswer = 42\n');
    writeFileSync(
      join(codexHome, 'hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }, null, 2),
    );
    writeFileSync(join(codexHome, 'AGENTS.md'), '# User guidance\n\nKeep me.\n');
    writeFileSync(join(claudeHome, 'sentinel'), 'claude-untouched');

    const env = { ...process.env, HOME: home, CODEX_HOME: codexHome };
    execFileSync(process.execPath, ['scripts/codex/setup.mjs'], { cwd: repoRoot, env });
    const first = {
      config: readFileSync(join(codexHome, 'config.toml'), 'utf8'),
      hooks: readFileSync(join(codexHome, 'hooks.json'), 'utf8'),
      agents: treeHash(join(codexHome, 'agents')),
      guidance: readFileSync(join(codexHome, 'AGENTS.md'), 'utf8'),
    };
    execFileSync(process.execPath, ['scripts/codex/setup.mjs'], { cwd: repoRoot, env });

    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe(first.config);
    expect(readFileSync(join(codexHome, 'hooks.json'), 'utf8')).toBe(first.hooks);
    expect(treeHash(join(codexHome, 'agents'))).toBe(first.agents);
    expect(readFileSync(join(codexHome, 'AGENTS.md'), 'utf8')).toBe(first.guidance);
    expect(first.config).toContain('[custom]\nanswer = 42');
    expect(first.hooks).toContain('user-hook');
    expect(first.guidance).toContain('Keep me.');
    expect(readFileSync(join(claudeHome, 'sentinel'), 'utf8')).toBe('claude-untouched');
  });

  it('removes only managed Codex assets and leaves Claude and user content intact', () => {
    const home = tempHome();
    const codexHome = join(home, '.codex');
    const claudeHome = join(home, '.claude');
    mkdirSync(join(codexHome, 'agents'), { recursive: true });
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), 'model = "user-model"\n[custom]\nanswer = 42\n');
    writeFileSync(
      join(codexHome, 'hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }, null, 2),
    );
    writeFileSync(join(codexHome, 'AGENTS.md'), '# User guidance\n\nKeep me.\n');
    writeFileSync(join(codexHome, 'agents/user-agent.toml'), 'name = "user-agent"\n');
    writeFileSync(join(claudeHome, 'sentinel'), 'claude-untouched');

    const env = { ...process.env, HOME: home, CODEX_HOME: codexHome };
    execFileSync(process.execPath, ['scripts/codex/setup.mjs'], { cwd: repoRoot, env });
    execFileSync(process.execPath, ['scripts/codex/setup.mjs', '--remove'], { cwd: repoRoot, env });

    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain('[custom]\nanswer = 42');
    expect(readFileSync(join(codexHome, 'hooks.json'), 'utf8')).toContain('user-hook');
    expect(readFileSync(join(codexHome, 'hooks.json'), 'utf8')).not.toContain('hook-adapter.mjs');
    expect(readFileSync(join(codexHome, 'AGENTS.md'), 'utf8')).toBe('# User guidance\n\nKeep me.\n');
    expect(readFileSync(join(codexHome, 'agents/user-agent.toml'), 'utf8')).toContain('user-agent');
    expect(readdirSync(join(codexHome, 'agents')).filter((name) => name.startsWith('omc-'))).toEqual([]);
    expect(readFileSync(join(claudeHome, 'sentinel'), 'utf8')).toBe('claude-untouched');
  });

  it('preserves legacy hook trust state outside the current Codex hook schema', () => {
    const home = tempHome();
    const codexHome = join(home, '.codex');
    mkdirSync(codexHome, { recursive: true });
    const legacyState = { 'user-hook:0:0': { trusted_hash: 'sha256:user-owned' } };
    writeFileSync(
      join(codexHome, 'hooks.json'),
      JSON.stringify(
        { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] }, state: legacyState },
        null,
        2,
      ),
    );

    const env = { ...process.env, HOME: home, CODEX_HOME: codexHome };
    execFileSync(process.execPath, ['scripts/codex/setup.mjs'], { cwd: repoRoot, env });

    const hooks = readJson<Record<string, unknown>>(join(codexHome, 'hooks.json'));
    expect(Object.keys(hooks).sort()).toEqual(['hooks']);
    expect(readJson(join(codexHome, 'hooks-state.omc-preserved.json'))).toEqual(legacyState);
    expect(readFileSync(join(codexHome, 'hooks.json'), 'utf8')).toContain('user-hook');
  });
});
