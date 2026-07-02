/**
 * Verification Receipt (ESM) — the loop-completion evidence gate.
 *
 * A "receipt" is externally-produced evidence that a repo's verify command
 * passed for a specific code state. It records three things together:
 *   1. the verify command's process exit code (0 == green),
 *   2. the commit HEAD, and
 *   3. a working-state hash (`git diff HEAD` + `git status --porcelain`) so that
 *      *uncommitted* edits made after a green run also invalidate the receipt.
 *
 * This is a DISCIPLINE / FRICTION gate, not a cryptographic guarantee. The
 * producer and the agent under test share the same shell and filesystem, so a
 * deliberately evasive agent can reconstruct an identical git-state hash and
 * hand-write a "green" receipt. What it reliably closes is the lazy/accidental
 * self-report (an agent can no longer flip a boolean with zero artifact), and
 * it detects the common failure modes: red exit, code changed since the pass,
 * stale run, or the configured verify command changed. A real trust boundary
 * requires an EXTERNAL verifier (CI, a human, or OS-level attestation).
 *
 * Known limitations (see follow-ups): when HEAD is unborn (fresh `git init`,
 * no commits) or the directory is not a git repo, the working-state hash is
 * null and code-change detection falls back to the time window only.
 *
 * The producer (`scripts/verify-gate.mjs`) runs the command and writes the
 * receipt. Consumers (the Stop hook, the cancel/state-clear path) call
 * `evaluateReceiptGate()` to decide whether a loop may declare completion.
 *
 * Design note: git is invoked via execFileSync (no shell). The user-configured
 * verify command is intentionally run through a shell by the producer, since it
 * is an operator-provided command string (e.g. "pnpm test && pnpm lint"), not
 * untrusted input.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

export const RECEIPT_FILENAME = "verification-receipt.json";

/** Time backstop: even a HEAD-matching green receipt is re-required after this. */
export const RECEIPT_FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Tighter backstop used when the git working-state hash is unavailable (unborn
 * HEAD or non-git dir). Without the hash we cannot detect code edits, so a green
 * receipt is only trusted for a short window and is always flagged `degraded`.
 */
export const NO_GIT_FRESHNESS_MS = 2 * 60 * 1000; // 2 minutes

export function getReceiptPath(stateDir) {
  return join(stateDir, RECEIPT_FILENAME);
}

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

/**
 * Read a JSONC file, stripping // and /* *\/ comments.
 * Mirrors the tolerant approach already used by scripts/persistent-mode.mjs
 * (readSecurityConfigValue) for consistency across OMC hook scripts.
 */
function readJsonc(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readReceipt(stateDir) {
  return readJson(getReceiptPath(stateDir));
}

/**
 * Resolve the repo's verify command.
 * Precedence (per user decision): .claude/omc.jsonc → project-memory → null.
 */
export function resolveVerifyCommand(directory) {
  // 1) .claude/omc.jsonc (project) then ~/.config/claude-omc/config.jsonc (global)
  const jsoncPaths = [
    join(directory, ".claude", "omc.jsonc"),
    join(homedir(), ".config", "claude-omc", "config.jsonc"),
  ];
  for (const p of jsoncPaths) {
    const cfg = readJsonc(p);
    const cmd = cfg?.verify ?? cfg?.verification?.command;
    if (typeof cmd === "string" && cmd.trim()) return cmd.trim();
  }

  // 2) project-memory.json build.{test,lint,build}Command (chained with &&)
  const pm = readJson(join(directory, ".omc", "project-memory.json"));
  const build = pm?.build ?? {};
  const parts = [build.testCommand, build.lintCommand, build.buildCommand].filter(
    (c) => typeof c === "string" && c.trim(),
  );
  if (parts.length) return parts.join(" && ");

  return null;
}

function git(args, directory) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function currentHead(directory) {
  try {
    return git(["rev-parse", "HEAD"], directory).trim();
  } catch {
    return null; // unborn HEAD or not a git repo
  }
}

/**
 * Hash the exact current code state: HEAD + tracked diff + porcelain status
 * (which surfaces untracked files). Returns null when there is no committed
 * HEAD (fresh `git init`) or no git — callers then fall back to time freshness.
 */
export function workingStateHash(directory) {
  try {
    // Exclude .omc/ — OMC writes loop state and the receipt itself there, so
    // including it would make every receipt invalidate itself on the next write.
    const exclude = ":(exclude).omc";
    const head = git(["rev-parse", "HEAD"], directory).trim();
    const diff = git(["diff", "HEAD", "--", ".", exclude], directory);
    const status = git(["status", "--porcelain", "--", ".", exclude], directory);
    return createHash("sha256")
      .update(`${head}\0${diff}\0${status}`)
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * Construct a receipt object. Does NOT run the command — the caller supplies the
 * observed exitCode. `now` is injectable for testing.
 */
export function buildReceipt({ cmd, exitCode, tail = "", directory, now = Date.now() }) {
  return {
    schema: 1,
    cmd,
    exitCode,
    at: new Date(now).toISOString(),
    head: currentHead(directory),
    stateHash: workingStateHash(directory),
    tail: typeof tail === "string" ? tail.slice(-4000) : "",
  };
}

export function writeReceiptFile(stateDir, receipt) {
  mkdirSync(stateDir, { recursive: true });
  const target = getReceiptPath(stateDir);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2));
  renameSync(tmp, target);
  return target;
}

/**
 * Decide whether a loop may declare completion.
 * @returns {{status: string, allowExit: boolean, degraded: boolean, reason: string}}
 *   status ∈ green | red | stale-head | stale-time | missing | no-command
 */
export function evaluateReceiptGate(stateDir, directory, now = Date.now()) {
  const cmd = resolveVerifyCommand(directory);
  if (!cmd) {
    // Q1 decision: degrade to a loud warning (do not trap test-less repos).
    return {
      status: "no-command",
      allowExit: true,
      degraded: true,
      reason:
        "No verify command configured — completion is UNVERIFIED. " +
        "Set `verify` in .claude/omc.jsonc (or test/build/lint in project-memory) to enforce the gate.",
    };
  }

  const receipt = readReceipt(stateDir);
  if (!receipt) {
    return {
      status: "missing",
      allowExit: false,
      degraded: false,
      reason:
        "No verification receipt. Before completing, run: " +
        `node "$CLAUDE_PLUGIN_ROOT"/scripts/verify-gate.mjs ${JSON.stringify(cmd)}`,
    };
  }

  // The receipt must have been stamped with the command that is configured now.
  // Prevents stamping green with one command while a different (real) command is
  // configured — or vice versa. Not a full defense (a determined agent can swap
  // before stamping), but it closes the swap-after-stamp case cheaply.
  if (typeof receipt.cmd === "string" && receipt.cmd !== cmd) {
    return {
      status: "cmd-changed",
      allowExit: false,
      degraded: false,
      reason:
        `The configured verify command changed since the receipt was stamped ` +
        `(receipt: \`${receipt.cmd}\` vs current: \`${cmd}\`). Re-run verify-gate with the current command.`,
    };
  }

  if (receipt.exitCode !== 0) {
    return {
      status: "red",
      allowExit: false,
      degraded: false,
      reason:
        `Verification is RED (exit ${receipt.exitCode}) from \`${receipt.cmd}\`. ` +
        `Fix the failures and re-run verify-gate. Output tail:\n${(receipt.tail || "").slice(-800)}`,
    };
  }

  const cur = workingStateHash(directory);
  // canBind is false for unborn HEAD / non-git dirs — code-change detection is
  // impossible there, so we fall back to a tighter time window and flag degraded.
  const canBind = Boolean(receipt.stateHash && cur);

  if (canBind && receipt.stateHash !== cur) {
    return {
      status: "stale-head",
      allowExit: false,
      degraded: false,
      reason:
        "Code changed since the last green verification (committed or working-tree edits). " +
        "Re-run verify-gate to reconfirm before completing.",
    };
  }

  const at = Date.parse(receipt.at ?? "");
  const freshnessMs = canBind ? RECEIPT_FRESHNESS_MS : NO_GIT_FRESHNESS_MS;
  if (!Number.isFinite(at) || now - at > freshnessMs) {
    return {
      status: "stale-time",
      allowExit: false,
      degraded: false,
      reason: canBind
        ? "Verification receipt is stale (older than the freshness window). Re-run verify-gate."
        : "Verification receipt is stale, and there is no git binding to detect code changes. Re-run verify-gate immediately before completing.",
    };
  }

  return {
    status: "green",
    allowExit: true,
    degraded: !canBind,
    reason: canBind
      ? "Verification receipt is green for the current code state."
      : "Verification receipt is green, but no git binding exists — code changes are NOT detected. Treat as low-assurance.",
  };
}
