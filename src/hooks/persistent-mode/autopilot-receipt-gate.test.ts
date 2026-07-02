import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runtime contract for the autopilot completion gate in scripts/persistent-mode.mjs.
 * A self-reported `phase: "complete"` must NOT let the loop exit unless a fresh
 * green verification receipt exists for the current code state. Mirrors the
 * ultraqa gate — `phase === "complete"` is the same cheat class as `all_passing`.
 */
describe("autopilot receipt gate (persistent-mode.mjs runtime)", () => {
  const repoRoot = process.cwd();
  const stopHook = join(repoRoot, "scripts", "persistent-mode.mjs");
  const verifyGate = join(repoRoot, "scripts", "verify-gate.mjs");
  let tempDir: string;
  const sessionId = "autopilot-gate-test";

  function git(cmd: string): void {
    execSync(`git ${cmd}`, { cwd: tempDir, stdio: "ignore" });
  }

  function runStopHook(): Record<string, unknown> {
    try {
      const out = execSync(`node "${stopHook}"`, {
        encoding: "utf-8",
        timeout: 8000,
        input: JSON.stringify({ directory: tempDir, sessionId }),
        env: { ...process.env, NODE_ENV: "test" },
      });
      const lines = out.trim().split("\n");
      return JSON.parse(lines[lines.length - 1]);
    } catch (error: unknown) {
      const e = error as { stdout?: string };
      if (e.stdout) {
        const lines = e.stdout.trim().split("\n");
        return JSON.parse(lines[lines.length - 1]);
      }
      throw error;
    }
  }

  function writeAutopilotState(phase: string): void {
    const sessionDir = join(tempDir, ".omc", "state", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(sessionDir, "autopilot-state.json"),
      JSON.stringify({
        active: true,
        phase,
        session_id: sessionId,
        started_at: now,
        last_checked_at: now,
      }),
    );
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "autopilot-gate-"));
    git("init -q");
    git("config user.email test@example.com");
    git("config user.name test");
    writeFileSync(join(tempDir, "app.txt"), "v1");
    git("add -A");
    git("commit -q -m init");
    // Configure a trivially-green verify command so the gate is active (not degraded).
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(join(tempDir, ".claude", "omc.jsonc"), '{"verify":"true"}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks exit when phase is complete but no receipt exists (anti-cheat)", () => {
    writeAutopilotState("complete");
    const out = runStopHook();
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("AUTOPILOT GATE");
  });

  it("allows exit after verify-gate stamps a green receipt for current HEAD", () => {
    writeAutopilotState("complete");
    // Producer runs the (green) command and writes the receipt.
    execSync(`node "${verifyGate}" "true"`, { cwd: tempDir, stdio: "ignore" });
    const out = runStopHook();
    expect(out.continue).toBe(true);
    expect(out.decision).toBeUndefined();
  });

  it("re-blocks if code changes after a green receipt (stale evidence)", () => {
    writeAutopilotState("complete");
    execSync(`node "${verifyGate}" "true"`, { cwd: tempDir, stdio: "ignore" });
    // Edit code after the green run — receipt no longer matches working state.
    writeFileSync(join(tempDir, "app.txt"), "v2-uncommitted");
    const out = runStopHook();
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("AUTOPILOT GATE");
  });

  it("still blocks a normal in-progress phase (not complete)", () => {
    writeAutopilotState("implement");
    const out = runStopHook();
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("AUTOPILOT - Phase");
  });
});
