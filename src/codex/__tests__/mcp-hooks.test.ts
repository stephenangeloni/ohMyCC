import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Codex plugin MCP', () => {
  it('starts the cache-contained standard MCP server and lists OMC tools', async () => {
    const pluginRoot = join(repoRoot, 'codex');
    const config = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf8'));
    const server = config.mcpServers.omc;
    const transport = new StdioClientTransport({ command: server.command, args: server.args, cwd: pluginRoot, stderr: 'pipe' });
    const client = new Client({ name: 'ohmycc-codex-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const response = await client.listTools();
      const names = response.tools.map((tool) => tool.name);
      expect(names.length).toBeGreaterThanOrEqual(33);
      expect(names).toEqual(expect.arrayContaining([
        'state_read',
        'project_memory_read',
        'trace_timeline',
        'wiki_query',
        'list_omc_skills',
      ]));
    } finally {
      await client.close();
    }
  });

  it('does not use the Claude Agent SDK-specific MCP server', () => {
    const config = readFileSync(join(repoRoot, 'codex/.mcp.json'), 'utf8');
    expect(config).toContain('mcp-server.cjs');
    expect(config).not.toContain('omc-tools-server');
    expect(config).not.toContain('@anthropic-ai/claude-agent-sdk');
  });
});

describe('Codex hook adapter', () => {
  it('normalizes every supported event and capability-gates unavailable events', () => {
    const capabilities = JSON.parse(readFileSync(join(repoRoot, 'codex/hook-capabilities.json'), 'utf8'));
    const log = join(mkdtempSync(join(tmpdir(), 'ohmycc-hooks-')), 'events.jsonl');
    const adapter = join(repoRoot, 'scripts/codex/hook-adapter.mjs');
    for (const event of capabilities.supported) {
      const result = spawnSync(process.execPath, [adapter], {
        input: JSON.stringify({ hookEventName: event, sessionId: 'session-1', cwd: repoRoot, toolName: 'Bash' }),
        encoding: 'utf8',
        env: { ...process.env, OMC_CODEX_HOOK_LOG: log },
      });
      expect(result.status).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      if (event === 'SessionStart') {
        expect(JSON.parse(result.stdout)).toEqual({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: expect.stringContaining('ohMyCC Codex adapters are active'),
          },
        });
      }
    }
    const normalized = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(normalized.map((entry) => entry.hook_event_name)).toEqual(capabilities.supported);
    expect(capabilities.unavailable).toEqual([
      'PostToolUseFailure',
      'SessionEnd',
    ]);

    const unavailable = execFileSync(process.execPath, [adapter], {
      input: JSON.stringify({ hook_event_name: 'PostToolUseFailure' }),
      encoding: 'utf8',
    });
    expect(JSON.parse(unavailable)).toEqual({});
  });
});
