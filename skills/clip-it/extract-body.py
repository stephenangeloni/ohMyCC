#!/usr/bin/env python3
"""Extract the previous assistant text response from the active Claude Code
session transcript. Writes the body to stdout.

Used by the /clip-it slash command to avoid having Claude re-emit the body
verbatim through a tool call — the body is read off disk from the session
JSONL instead.

After locating the body, the script spawns a fresh `claude -p --model haiku`
subprocess with no session context and asks it: "if this response wraps a
prompt the user wants pasted somewhere else, return only the prompt
content; otherwise return the body verbatim." This handles wrappings the
old triple-backtick regex couldn't see (XML tags, quote blocks, "Here's
the prompt:" preambles, etc.). If the subprocess is unavailable or fails,
the legacy fence-regex pass runs as a fallback.

The subprocess is deliberately pinned to haiku: it is a separate, headless
`claude -p` process with no shared context, so its model choice never touches
this conversation's prompt cache — it is free to optimize purely for cost and
latency, and haiku is the cheapest/fastest fit for the bounded prompt-vs-verbatim
classification. Change it to sonnet only if you observe mis-unwrapping; never
opus.

Anchoring is namespace-tolerant: it matches both the bare personal command form
`/clip-it` and the plugin-namespaced form `/oh-my-claudecode:clip-it`, so the same
script works whether clip-it is installed as a personal command or shipped inside
the OMC plugin.

Exit codes:
  0  body written to stdout
  2  no Claude Code project directory for $PWD
  3  no session transcript found
  4  no /clip-it user message found to anchor against
  5  no prior assistant text message before the anchor
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


# Distinctive marker injected by Claude Code when expanding the slash command.
# Matches BOTH the bare personal form `<command-name>/clip-it</command-name>`
# and the plugin-namespaced form `<command-name>/oh-my-claudecode:clip-it</command-name>`
# (or any `<plugin>:clip-it`), so the same script works regardless of how the
# command is installed. Anchoring on the tag (not a bare "/clip-it" in prose)
# prevents false matches if assistant text happens to mention "/clip-it".
ANCHOR_RE = re.compile(r"<command-name>/?(?:[\w.-]+:)?clip-it</command-name>")


def has_clip_it_anchor(text: str) -> bool:
    """True if `text` contains a /clip-it (or /<plugin>:clip-it) command marker."""
    return ANCHOR_RE.search(text) is not None


# Matches a triple-backtick fenced code block: opening fence at line start
# (with optional language tag), content, then closing fence on its own line.
# MULTILINE so `^`/`$` are line anchors; DOTALL so `.` matches newlines.
FENCE_RE = re.compile(
    r"^```[^\n]*\n(.*?)\n^```[ \t]*$",
    re.MULTILINE | re.DOTALL,
)


# Instruction handed to the fresh `claude -p` subprocess. It must (1) detect
# whether the assistant response wraps a prompt the user wants pasted
# elsewhere, and (2) either return the prompt's literal content (no wrapper)
# or return the body verbatim. Phrased to prevent haiku from adding its own
# preamble / fences / commentary.
SMART_EXTRACT_INSTRUCTION = """You are a deterministic text-extraction utility. You will receive an assistant's previous response inside <assistant_response> tags below.

Decide one of two cases:

CASE A — the response contains a PROMPT that the user is meant to copy and paste into another LLM, a notes app, or anywhere else as a fresh, standalone instruction. Signals: phrases like "here's the prompt", "copy this", "use this prompt", "send this to", a clearly delimited block (fenced, quoted, XML-tagged, indented, or labeled) surrounded by meta-prose, or a self-contained instruction set framed as something the user will hand off.
  → Output ONLY the prompt's literal content. Strip every wrapper: preambles ("Here's the prompt:", "Try this:"), closing commentary ("Let me know how it goes"), code fences that are not part of the prompt itself, XML tags that are not part of the prompt itself, leading/trailing blank lines.

CASE B — the response is a regular answer, explanation, summary, code review, conversation reply, etc. (NOT a prompt to be re-used).
  → Output the response VERBATIM. Do not edit, reformat, summarize, or comment on it.

Hard rules for your output:
- Output the result and nothing else. No "Here is the extracted prompt:" line. No "This appears to be a regular answer." No trailing notes.
- Do NOT wrap your output in code fences unless those fences are part of the literal prompt content from CASE A.
- Do NOT translate, paraphrase, or modify whitespace beyond stripping the wrapper.
- If you are uncertain whether the content is a prompt, default to CASE B (verbatim).
"""


def smart_extract_via_claude(body: str, timeout: int = 60) -> str | None:
    """Spawn a fresh, no-context `claude -p` subprocess (haiku) and ask it to
    decide whether `body` wraps a prompt and, if so, return only the prompt.
    Returns None on any failure — caller falls back to fence regex.

    The subprocess inherits no session state because `claude -p` is a
    one-shot non-interactive invocation; it does not read the caller's
    transcript or memory.
    """
    if not shutil.which("claude"):
        return None
    prompt = f"{SMART_EXTRACT_INSTRUCTION}\n<assistant_response>\n{body}\n</assistant_response>"
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--model", "haiku"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    out = result.stdout.strip("\n")
    return out or None


def extract_fenced(body: str) -> str | None:
    """If the body contains one or more triple-backtick fenced blocks, return
    their concatenated contents (delimiters and any language tag stripped).
    Multiple blocks are joined with a blank line. Returns None when no
    fenced block is present — caller falls back to the full body.
    """
    matches = FENCE_RE.findall(body)
    if not matches:
        return None
    return "\n\n".join(matches)


def find_project_dir() -> Path:
    cwd = Path.cwd().resolve()
    slug = str(cwd).replace("/", "-").replace("_", "-")
    return Path.home() / ".claude" / "projects" / slug


def pick_active_session(project_dir: Path) -> Path | None:
    jsonls = sorted(
        project_dir.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return jsonls[0] if jsonls else None


def record_text(rec: dict) -> str | None:
    """Return concatenated textual content, or None if the record has none.

    Handles both content shapes Claude Code uses:
      - string:  free-typed user messages
      - list:    tool_results, slash-command expansions, assistant turns
                 (blocks with type 'text' are concatenated; other block
                  types like 'tool_result' / 'thinking' are ignored here)
    """
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content if content else None
    if isinstance(content, list):
        parts = [
            c.get("text", "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        if not parts:
            return None
        return "".join(parts)
    return None


def load_records(session: Path) -> list[dict]:
    recs: list[dict] = []
    with session.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return recs


def find_anchor(records: list[dict]) -> int | None:
    """Index of the most recent user record that is a /clip-it invocation.

    Anchors strictly on the `<command-name>.../clip-it</command-name>` tag
    (bare or plugin-namespaced), which Claude Code emits only when expanding
    the slash command. Plain user messages that merely mention '/clip-it' in
    prose are NOT anchors.
    """
    for i in range(len(records) - 1, -1, -1):
        rec = records[i]
        if rec.get("type") != "user":
            continue
        txt = record_text(rec) or ""
        if has_clip_it_anchor(txt):
            return i
    return None


# Tags Claude Code injects around a slash-command invocation. A string-form
# user record containing any of these is invocation *machinery* — not a genuine
# user turn — so the parentUuid walk must pass straight through it to reach the
# real assistant response being copied. Critically includes
# <local-command-caveat>, which Claude Code emits as its OWN user record
# immediately before the command wrapper; without it the walk stops there and
# collects nothing (exit 5).
_SLASH_SCAFFOLD_TAGS = (
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-caveat>",
    "<local-command-stdout>",
)


def _is_slash_command_wrapper(rec: dict) -> bool:
    """True if this user record is slash-command scaffolding (the string-form
    wrapper, or the local-command caveat/stdout records Claude Code emits around
    a slash-command invocation) rather than a genuine user turn.

    Claude Code emits several machinery records per slash-command invocation: a
    `<local-command-caveat>` note, a string wrapper carrying
    `<command-message>/<command-name>/<command-args>` tags, and the expanded
    template. None are turn boundaries — they belong to the same invocation, so
    the parentUuid walk must pass through them.
    """
    if rec.get("type") != "user":
        return False
    content = (rec.get("message") or {}).get("content")
    if not isinstance(content, str):
        return False
    return any(tag in content for tag in _SLASH_SCAFFOLD_TAGS)


def _is_real_user_turn(rec: dict) -> bool:
    """True iff this record represents an actual user turn boundary."""
    if rec.get("type") != "user":
        return False
    if _is_slash_command_wrapper(rec):
        return False
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return bool(content)
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text" and block.get("text"):
                return True
            if btype == "tool_result":
                return True
    return False


def collect_prior_text(records: list[dict], anchor: int) -> str | None:
    """Walk the parentUuid chain backward from the anchor, collecting
    assistant text blocks until a real user turn (or a prior /clip-it).

    Boundary (stops the walk): a real user turn, OR any prior /clip-it
    invocation. Without the second boundary, consecutive /clip-it calls on
    the same branch would pull in body text from before the prior call.
    """
    by_uuid = {r.get("uuid"): r for r in records if r.get("uuid")}
    collected: list[str] = []
    cur = records[anchor].get("parentUuid")
    while cur:
        rec = by_uuid.get(cur)
        if rec is None:
            break
        if _is_real_user_turn(rec):
            break
        if rec.get("type") == "user" and has_clip_it_anchor(record_text(rec) or ""):
            break
        if rec.get("type") == "assistant":
            txt = record_text(rec)
            if txt:
                collected.append(txt)
        cur = rec.get("parentUuid")
    if not collected:
        return None
    return "\n".join(reversed(collected))


def main() -> int:
    project_dir = find_project_dir()
    if not project_dir.is_dir():
        print(f"extract-body: no project dir at {project_dir}", file=sys.stderr)
        return 2

    session = pick_active_session(project_dir)
    if session is None:
        print(f"extract-body: no *.jsonl in {project_dir}", file=sys.stderr)
        return 3

    records = load_records(session)
    anchor = find_anchor(records)
    if anchor is None:
        print("extract-body: no /clip-it user message found", file=sys.stderr)
        return 4

    body = collect_prior_text(records, anchor)
    if body is None:
        print("extract-body: no prior assistant text before anchor", file=sys.stderr)
        return 5

    # Always ask a fresh, no-context haiku subprocess to decide whether the
    # body wraps a prompt the user wants pasted elsewhere. The subprocess
    # returns either the unwrapped prompt or the body verbatim.
    smart = smart_extract_via_claude(body)
    if smart is not None:
        body = smart
    else:
        # Subprocess unavailable (no `claude` on PATH, timeout, non-zero
        # exit, empty output). Fall back to the legacy fenced-block pass:
        # if the body contains triple-backtick fences, use their contents.
        fenced = extract_fenced(body)
        if fenced is not None:
            body = fenced

    sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
