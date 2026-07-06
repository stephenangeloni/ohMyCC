#!/usr/bin/env python3
"""Regression tests for skills/clip-it/extract-body.py.

Dependency-free (no pytest): run with
    python3 skills/clip-it/test_extract_body.py
Exits 0 if all checks pass, 1 on any failure.

Guards the two environment-specific bugs found when clip-it was migrated from a
personal ~/.claude command into the OMC plugin — both are transcript-shape
assumptions that only surface once the command is namespaced:

  1. Namespaced anchor — the walk must recognize `/oh-my-claudecode:clip-it`,
     not only the bare `/clip-it`, or find_anchor never matches (exit 4).
  2. Caveat boundary — the `<local-command-caveat>` user record Claude Code
     emits immediately before a slash-command wrapper must NOT count as a real
     user turn, or collect_prior_text stops there and returns nothing (exit 5).
"""

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("extract_body", HERE / "extract-body.py")
eb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eb)

_failures: list[str] = []


def check(name: str, cond: bool) -> None:
    print(("PASS" if cond else "FAIL"), name)
    if not cond:
        _failures.append(name)


# --- Bug #1: anchor matching is namespace-tolerant but not over-eager ---------
check("anchor: bare /clip-it",
      eb.has_clip_it_anchor("<command-name>/clip-it</command-name>"))
check("anchor: namespaced /oh-my-claudecode:clip-it",
      eb.has_clip_it_anchor("<command-name>/oh-my-claudecode:clip-it</command-name>"))
check("anchor: namespaced without leading slash",
      eb.has_clip_it_anchor("<command-name>oh-my-claudecode:clip-it</command-name>"))
check("anchor: rejects sibling command (cpr)",
      not eb.has_clip_it_anchor("<command-name>/oh-my-claudecode:cpr</command-name>"))
check("anchor: rejects clip-it-helper substring trap",
      not eb.has_clip_it_anchor("<command-name>/x:clip-it-helper</command-name>"))
check("anchor: rejects a prose mention of /clip-it",
      not eb.has_clip_it_anchor("I ran /clip-it earlier in the chat"))


# --- Bug #2: slash-command scaffolding is machinery, not a user turn ----------
caveat = {"type": "user", "message": {"content": "<local-command-caveat>Caveat: ...</local-command-caveat>"}}
wrapper = {"type": "user", "message": {"content": "<command-name>/oh-my-claudecode:clip-it</command-name>"}}
genuine = {"type": "user", "message": {"content": "please copy that"}}
check("caveat record is NOT a real user turn", eb._is_real_user_turn(caveat) is False)
check("wrapper record is NOT a real user turn", eb._is_real_user_turn(wrapper) is False)
check("genuine text IS a real user turn", eb._is_real_user_turn(genuine) is True)


# --- End-to-end: collect_prior_text over a synthetic plugin invocation --------
# parentUuid chain (oldest -> newest):
#   u0(user) -> a1(assistant) -> x2(attachment) -> c3(caveat) -> w4(clip-it wrapper=anchor)
records = [
    {"type": "user",       "uuid": "u0", "parentUuid": None,
     "message": {"content": "please do the thing"}},
    {"type": "assistant",  "uuid": "a1", "parentUuid": "u0",
     "message": {"content": [{"type": "text", "text": "THE ANSWER TO COPY"}]}},
    {"type": "attachment", "uuid": "x2", "parentUuid": "a1"},
    {"type": "user",       "uuid": "c3", "parentUuid": "x2",
     "message": {"content": "<local-command-caveat>Caveat: ...</local-command-caveat>"}},
    {"type": "user",       "uuid": "w4", "parentUuid": "c3",
     "message": {"content": ("<command-message>oh-my-claudecode:clip-it</command-message>\n"
                             "<command-name>/oh-my-claudecode:clip-it</command-name>\n"
                             "<command-args></command-args>")}},
]
anchor = eb.find_anchor(records)
check("find_anchor locates the clip-it wrapper (idx 4)", anchor == 4)
check("collect_prior_text walks past the caveat to the response",
      eb.collect_prior_text(records, anchor) == "THE ANSWER TO COPY")


# --- Boundary holds: the walk stops at a genuine prior user turn --------------
# An older assistant answer before the real user turn must NOT bleed in.
records2 = [
    {"type": "assistant", "uuid": "aOld", "parentUuid": None,
     "message": {"content": [{"type": "text", "text": "OLD ANSWER — must NOT be copied"}]}},
    {"type": "user",      "uuid": "u0", "parentUuid": "aOld",
     "message": {"content": "please do the thing"}},
    {"type": "assistant", "uuid": "a1", "parentUuid": "u0",
     "message": {"content": [{"type": "text", "text": "THE ANSWER TO COPY"}]}},
    {"type": "user",      "uuid": "c3", "parentUuid": "a1",
     "message": {"content": "<local-command-caveat>Caveat: ...</local-command-caveat>"}},
    {"type": "user",      "uuid": "w4", "parentUuid": "c3",
     "message": {"content": "<command-name>/clip-it</command-name>"}},
]
check("walk stops at the genuine user turn (no cross-turn bleed)",
      eb.collect_prior_text(records2, eb.find_anchor(records2)) == "THE ANSWER TO COPY")


if _failures:
    print(f"\n{len(_failures)} FAILURE(S): {_failures}")
    raise SystemExit(1)
print("\nAll checks passed.")
