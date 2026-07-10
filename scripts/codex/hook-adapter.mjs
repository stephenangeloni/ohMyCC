#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const supported = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop']);
let raw = '';
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const event = payload.hook_event_name ?? payload.hookEventName ?? payload.event ?? payload.name;
  if (!supported.has(event)) {
    process.stdout.write('{}\n');
    process.exit(0);
  }
  const normalized = {
    hook_event_name: event,
    session_id: payload.session_id ?? payload.sessionId,
    cwd: payload.cwd ?? process.cwd(),
    prompt: payload.prompt ?? payload.user_prompt ?? payload.input,
    tool_name: payload.tool_name ?? payload.toolName,
    tool_input: payload.tool_input ?? payload.toolInput,
    tool_response: payload.tool_response ?? payload.toolResponse ?? payload.result,
    transcript_path: payload.transcript_path ?? payload.transcriptPath,
  };
  if (process.env.OMC_CODEX_HOOK_LOG) {
    mkdirSync(dirname(process.env.OMC_CODEX_HOOK_LOG), { recursive: true });
    appendFileSync(process.env.OMC_CODEX_HOOK_LOG, `${JSON.stringify(normalized)}\n`);
  }
  if (event === 'SessionStart') {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'ohMyCC Codex adapters are active. Invoke plugin workflows with $skill-name and use omc-* native agents for delegated specialist work.',
      },
    })}\n`);
  } else {
    process.stdout.write('{}\n');
  }
} catch (error) {
  console.error(`[ohMyCC codex hook] ${error instanceof Error ? error.message : String(error)}`);
  process.stdout.write('{}\n');
}
