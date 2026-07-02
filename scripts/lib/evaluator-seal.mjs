/**
 * Evaluator Seal (ESM) — friction gate against editing the "grader" mid-loop.
 *
 * The verification-receipt gate (lib/verification-receipt.mjs) forces a
 * persistence loop to prove completion with a green verify command for the
 * current code state. The cheapest way to defeat that is to edit the *evaluator
 * itself* — weaken a test so it trivially passes, neuter the verify-gate script,
 * or disable CI — so the command goes green for the wrong reason. This module
 * classifies a tool's target path as part of the evaluator surface (test files,
 * CI config, or the gate's own machinery) and lets the PreToolUse hook surface a
 * warning (default) or a hard deny (opt-in) while a loop is active.
 *
 * HONEST SCOPE: this is a DISCIPLINE / FRICTION gate, not a security boundary.
 * It inspects only the structured edit tools (Edit/Write/MultiEdit/NotebookEdit);
 * a determined agent can still rewrite a test via `Bash` (e.g. a heredoc) or by
 * disabling the hook. It closes the lazy/accidental "edit the test so the receipt
 * goes green" path — it does not stop a deliberate adversary sharing the sandbox.
 * A real trust boundary requires an EXTERNAL verifier (CI, a human).
 *
 * Enforcement level (default = warn), resolved per-directory:
 *   OMC_SEAL_EVALUATOR env             → off|0|false|no|none · warn|warning · deny|1|true|strict|block|on|yes
 *   .claude/omc.jsonc `sealEvaluator`  → false → off · "warn" → warn · true|"deny"|"strict"|"block" → deny
 * env wins over config; config wins over the built-in 'warn' default.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const EDIT_TOOL_NAMES = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

export function isEvaluatorEditTool(toolName) {
  return EDIT_TOOL_NAMES.has(toolName);
}

// A path is on the evaluator surface if it is a test file, a CI definition, or
// the receipt gate's own machinery. Patterns run against a forward-slash-
// normalized path so Windows separators behave identically.
const TEST_FILE_PATTERNS = [
  // foo.test.ts / foo.spec.jsx / foo.test.mjs / foo.test.cjs, etc.
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
  // A dedicated test/spec directory anywhere in the path.
  /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|e2e)\//i,
];
const CI_FILE_PATTERNS = [
  /(?:^|\/)\.github\/workflows\//i,
  /(?:^|\/)\.gitlab-ci\.ya?ml$/i,
  /(?:^|\/)\.circleci\//i,
  /(?:^|\/)Jenkinsfile$/i,
  /(?:^|\/)azure-pipelines\.ya?ml$/i,
  /(?:^|\/)\.travis\.ya?ml$/i,
  /(?:^|\/)bitbucket-pipelines\.ya?ml$/i,
  /(?:^|\/)\.drone\.ya?ml$/i,
];
const GATE_MACHINERY_PATTERNS = [
  /(?:^|\/)scripts\/verify-gate\.mjs$/i,
  /(?:^|\/)scripts\/lib\/verification-receipt\.mjs$/i,
  /(?:^|\/)verification-receipt\.json$/i,
];

/**
 * @returns {"test"|"ci"|"gate-machinery"|null}
 */
export function classifyEvaluatorPath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return null;
  const p = rawPath.replace(/\\/g, "/");
  if (TEST_FILE_PATTERNS.some((re) => re.test(p))) return "test";
  if (CI_FILE_PATTERNS.some((re) => re.test(p))) return "ci";
  if (GATE_MACHINERY_PATTERNS.some((re) => re.test(p))) return "gate-machinery";
  return null;
}

/** Pull the target path(s) out of an edit tool's input. */
export function extractEditPaths(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const out = [];
  for (const key of ["file_path", "filePath", "notebook_path", "notebookPath", "path"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  }
  return out;
}

function readSealConfigValue(directory) {
  try {
    const p = join(directory, ".claude", "omc.jsonc");
    if (!existsSync(p)) return undefined;
    const raw = readFileSync(p, "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(raw);
    return cfg?.sealEvaluator;
  } catch {
    return undefined;
  }
}

const OFF_TOKENS = new Set(["off", "0", "false", "no", "none"]);
const WARN_TOKENS = new Set(["warn", "warning"]);
const DENY_TOKENS = new Set(["deny", "1", "true", "strict", "block", "on", "yes"]);

/**
 * Resolve enforcement level for a directory: "off" | "warn" | "deny".
 * env wins over config; config wins over the built-in 'warn' default.
 */
export function resolveSealMode(directory, env = process.env) {
  const envVal = String(env?.OMC_SEAL_EVALUATOR ?? "").trim().toLowerCase();
  if (envVal) {
    if (OFF_TOKENS.has(envVal)) return "off";
    if (WARN_TOKENS.has(envVal)) return "warn";
    if (DENY_TOKENS.has(envVal)) return "deny";
  }

  const cfgVal = readSealConfigValue(directory);
  if (cfgVal === false) return "off";
  if (cfgVal === true) return "deny";
  if (typeof cfgVal === "string") {
    const v = cfgVal.trim().toLowerCase();
    if (OFF_TOKENS.has(v)) return "off";
    if (WARN_TOKENS.has(v)) return "warn";
    if (DENY_TOKENS.has(v)) return "deny";
  }

  return "warn";
}

const CATEGORY_LABEL = {
  test: "a test file",
  ci: "a CI definition",
  "gate-machinery": "the verify-gate machinery",
};

function buildReason(level, category, path) {
  const what = CATEGORY_LABEL[category] || "the evaluator";
  if (level === "deny") {
    return (
      `[EVALUATOR SEAL] A persistence loop is active and this edit targets ${what} ` +
      `(${category}: ${path}). Editing the grader to make the completion gate pass is not allowed. ` +
      `If the task legitimately requires this change, exit the loop first ` +
      `(/oh-my-claudecode:cancel), make the edit, then re-run verify-gate and restart — ` +
      `or set OMC_SEAL_EVALUATOR=warn to downgrade this to a warning.`
    );
  }
  return (
    `[EVALUATOR SEAL] Heads up: a persistence loop is active and you are editing ${what} ` +
    `(${category}: ${path}). Do NOT weaken a test, the verify-gate, or CI just to make the ` +
    `completion gate go green — change it only if the task genuinely requires it. ` +
    `Set OMC_SEAL_EVALUATOR=deny to hard-block these edits.`
  );
}

/**
 * Decide whether an about-to-run tool touches the evaluator during an active loop.
 * @returns {{level:"warn"|"deny", category:string, path:string, reason:string}|null}
 */
export function evaluateEvaluatorSeal({
  toolName,
  toolInput,
  modeActive,
  directory,
  env = process.env,
} = {}) {
  if (!modeActive) return null;
  if (!isEvaluatorEditTool(toolName)) return null;

  const mode = resolveSealMode(directory, env);
  if (mode === "off") return null;

  for (const path of extractEditPaths(toolInput)) {
    const category = classifyEvaluatorPath(path);
    if (category) {
      return { level: mode, category, path, reason: buildReason(mode, category, path) };
    }
  }
  return null;
}
