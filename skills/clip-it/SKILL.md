---
name: clip-it
description: Copy my previous response — or a standalone prompt it wraps — to the macOS clipboard via pbcopy, reading the body from the live session transcript instead of re-emitting it through a tool call.
---

# /clip-it — Copy the previous response to the clipboard

Copy the previous assistant response to the system clipboard. Like `/email-it`,
the body is **extracted from the live session transcript** by `extract-body.py`
— Claude does NOT re-emit the body through a tool call. That keeps markdown
byte-for-byte intact and avoids re-polluting this conversation's context with the
copied text.

After locating the body, the script spawns a fresh, no-context
`claude -p --model haiku` subprocess that decides whether the response wraps a
prompt the user wants pasted somewhere else. If so, only the prompt's literal
content is returned (preamble, closing commentary, fences, XML tags — all
stripped). If not, the body is returned verbatim. If the subprocess is
unavailable, the legacy fenced-block regex runs as a fallback.

> **Why the subprocess is pinned to haiku.** It is a *separate*, headless
> `claude -p` process with no shared session context, so its model choice never
> touches this conversation's prompt cache — the choice is free to optimize purely
> for cost and latency. Haiku is the cheapest and fastest fit for the bounded
> prompt-vs-verbatim classification, and pinning it decouples the call from
> whatever your main session model is (otherwise every `/clip-it` would fire an
> Opus call). If you ever observe it mis-unwrapping a complex prompt, change
> `--model haiku` → `--model sonnet` in `extract-body.py` — never Opus, and it
> still won't affect any cache.

## One Bash call does everything

Execute this as **one** Bash tool call. Resolve `{skill_dir}` to the directory
that contains this SKILL.md (this skill's own folder in the active OMC
plugin/install):

```bash
body=$(python3 "{skill_dir}/extract-body.py") && printf %s "$body" | pbcopy && echo "Copied ${#body} chars to clipboard."
```

How it works:

- `extract-body.py` finds the active Claude Code session transcript (most-recent
  `*.jsonl` under `~/.claude/projects/<cwd-slug>/`), locates the most recent user
  record containing the clip-it command marker — it matches both the bare
  `/clip-it` form and the plugin-namespaced `/oh-my-claudecode:clip-it` form — and
  walks backward through the `parentUuid` chain collecting assistant text blocks
  until a real prior user turn. That text becomes the body.
- `printf %s "$body" | pbcopy` writes the body to the macOS clipboard exactly.
  Markdown stays markdown — no formatting changes.
- `&&` short-circuits: if extraction fails, `pbcopy` is never called and the
  clipboard is left untouched.

Report back the line that the bash call printed (e.g. `Copied 2487 chars to
clipboard.`).

## Failure modes

If `extract-body.py` exits non-zero, the bash command fails and stderr will show
one of:

- `no project dir at ~/.claude/projects/...` — running outside a Claude Code session (exit 2)
- `no *.jsonl in ...` — no session transcript yet (exit 3)
- `no /clip-it user message found` — anchor missing; should not happen if you just ran the command (exit 4)
- `no prior assistant text before anchor` — first response in conversation (exit 5)

In all cases, report the stderr verbatim — don't try to recover.
