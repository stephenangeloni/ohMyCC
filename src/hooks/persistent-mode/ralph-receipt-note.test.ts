import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ralph keeps blocking every heartbeat until /cancel (unchanged). This suite
 * verifies the added behavior: the block reason surfaces the verification
 * receipt status, so completion is tied to command-derived evidence rather than
 * an unqualified self-declared cancel.
 */
describe("ralph receipt note (persistent-mode.mjs runtime)", () => {
  const repoRoot = process.cwd();
  const stopHook = join(repoRoot, "scripts", "persistent-mode.mjs");
  const verifyGate = join(repoRoot, "scripts", "verify-gate.mjs");
  let tempDir: string;
  const sessionId = "ralph-receipt-note-test";

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

  function writeActiveRalph(): void {
    const sessionDir = join(tempDir, ".omc", "state", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(sessionDir, "ralph-state.json"),
      JSON.stringify({
        active: true,
        iteration: 1,
        max_iterations: 50,
        session_id: sessionId,
        started_at: now,
        last_checked_at: now,
        prompt: "do the thing",
      }),
    );
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-receipt-"));
    git("init -q");
    git("config user.email test@example.com");
    git("config user.name test");
    writeFileSync(join(tempDir, "app.txt"), "v1");
    git("add -A");
    git("commit -q -m init");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("still blocks, and tells the agent to run verify-gate when no receipt exists", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(join(tempDir, ".claude", "omc.jsonc"), '{"verify":"true"}');
    writeActiveRalph();
    const out = runStopHook();
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("[RALPH LOOP");
    expect(String(out.reason)).toContain("Not verified");
    expect(String(out.reason)).toContain("verify-gate");
  });

  it("reports a GREEN receipt in the reason once verify-gate has stamped one", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(join(tempDir, ".claude", "omc.jsonc"), '{"verify":"true"}');
    writeActiveRalph();
    execSync(`node "${verifyGate}" "true"`, { cwd: tempDir, stdio: "ignore" });
    const out = runStopHook();
    expect(out.decision).toBe("block"); // ralph exits via /cancel, not the hook
    expect(String(out.reason)).toContain("GREEN");
  });

  it("warns that completion is unverified when no verify command is configured", () => {
    writeActiveRalph();
    const out = runStopHook();
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("No verify command configured");
  });
});
