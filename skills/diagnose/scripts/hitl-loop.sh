#!/usr/bin/env bash
# Human-in-the-loop (HITL) reproduction loop — Phase 1 last resort.
#
# Use when the bug can only be triggered by a human action the agent cannot drive.
# Copy this file, edit the block between the markers, and run it. The agent runs the
# script; the user follows the prompts in their terminal. Captured values are printed
# as KEY=VALUE at the end for the agent to parse.
#
# Usage:
#   bash scripts/hitl-loop.sh
#
# Helpers:
#   step "<instruction>"        -> show instruction, wait for Enter
#   capture VAR "<question>"    -> show question, read the response into VAR

set -euo pipefail

CAPTURED=()

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
  CAPTURED+=("$var")
}

# --- edit below ---------------------------------------------------------

step "Open the app at http://localhost:3000 and sign in."

capture ERRORED "Click the 'Export' button. Did it throw an error? (y/n)"

capture ERROR_MSG "Paste the error message (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
for var in "${CAPTURED[@]}"; do
  printf '%s=%s\n' "$var" "${!var}"
done
