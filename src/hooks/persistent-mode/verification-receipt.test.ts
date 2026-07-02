import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveVerifyCommand,
  evaluateReceiptGate,
  buildReceipt,
  writeReceiptFile,
  RECEIPT_FRESHNESS_MS,
  NO_GIT_FRESHNESS_MS,
  // @ts-expect-error — plain .mjs lib, no type declarations
} from "../../../scripts/lib/verification-receipt.mjs";

function git(cmd: string, cwd: string): void {
  execSync(`git ${cmd}`, { cwd, stdio: "ignore" });
}

function initRepo(dir: string): void {
  git("init -q", dir);
  git("config user.email test@example.com", dir);
  git("config user.name test", dir);
  writeFileSync(join(dir, "f.txt"), "hello");
  git("add -A", dir);
  git("commit -q -m init", dir);
}

describe("verification-receipt lib", () => {
  let dir: string;
  let stateDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vr-lib-test-"));
    stateDir = join(dir, ".omc", "state");
    mkdirSync(stateDir, { recursive: true });
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("resolveVerifyCommand", () => {
    it("prefers the .claude/omc.jsonc `verify` key (JSONC comments tolerated)", () => {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "omc.jsonc"),
        '{\n  // gate command\n  "verify": "make check"\n}',
      );
      expect(resolveVerifyCommand(dir)).toBe("make check");
    });

    it("falls back to project-memory build.{test,lint,build}Command", () => {
      writeFileSync(
        join(dir, ".omc", "project-memory.json"),
        JSON.stringify({ build: { testCommand: "pnpm test", lintCommand: "pnpm lint" } }),
      );
      const cmd = resolveVerifyCommand(dir);
      expect(cmd).toContain("pnpm test");
      expect(cmd).toContain("pnpm lint");
    });

    it("returns null when nothing is configured", () => {
      expect(resolveVerifyCommand(dir)).toBeNull();
    });
  });

  describe("evaluateReceiptGate", () => {
    beforeEach(() => {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "omc.jsonc"), '{"verify":"true"}');
    });

    it("degrades to allowExit + warn when no verify command is configured", () => {
      rmSync(join(dir, ".claude", "omc.jsonc"));
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("no-command");
      expect(g.allowExit).toBe(true);
      expect(g.degraded).toBe(true);
    });

    it("blocks when no receipt exists", () => {
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("missing");
      expect(g.allowExit).toBe(false);
    });

    it("blocks when the receipt is red (nonzero exit)", () => {
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 1, tail: "boom", directory: dir }));
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("red");
      expect(g.allowExit).toBe(false);
    });

    it("allows exit when the receipt is green for the current working state", () => {
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: dir }));
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("green");
      expect(g.allowExit).toBe(true);
    });

    it("blocks when committed code changed after the green receipt", () => {
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: dir }));
      writeFileSync(join(dir, "f2.txt"), "more");
      git("add -A", dir);
      git("commit -q -m more", dir);
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("stale-head");
      expect(g.allowExit).toBe(false);
    });

    it("blocks when the working tree was edited (uncommitted) after the green receipt", () => {
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: dir }));
      writeFileSync(join(dir, "f.txt"), "edited-but-not-committed");
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("stale-head");
      expect(g.allowExit).toBe(false);
    });

    it("blocks when the configured verify command changed after stamping", () => {
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: dir }));
      // Operator/agent repoints the verify command after the green stamp.
      writeFileSync(join(dir, ".claude", "omc.jsonc"), '{"verify":"pnpm test"}');
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("cmd-changed");
      expect(g.allowExit).toBe(false);
    });

    it("blocks when a green receipt is older than the freshness window", () => {
      const past = Date.now() - (RECEIPT_FRESHNESS_MS + 60_000);
      writeReceiptFile(stateDir, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: dir, now: past }));
      const g = evaluateReceiptGate(stateDir, dir);
      expect(g.status).toBe("stale-time");
      expect(g.allowExit).toBe(false);
    });
  });

  describe("evaluateReceiptGate — no git binding (unborn HEAD / non-git dir)", () => {
    let nogitDir: string;
    let nogitState: string;

    beforeEach(() => {
      // Deliberately NOT a git repo: currentHead()/workingStateHash() → null.
      nogitDir = mkdtempSync(join(tmpdir(), "vr-nogit-"));
      nogitState = join(nogitDir, ".omc", "state");
      mkdirSync(nogitState, { recursive: true });
      mkdirSync(join(nogitDir, ".claude"), { recursive: true });
      writeFileSync(join(nogitDir, ".claude", "omc.jsonc"), '{"verify":"true"}');
    });

    afterEach(() => {
      rmSync(nogitDir, { recursive: true, force: true });
    });

    it("allows exit but flags degraded when green within the short window", () => {
      writeReceiptFile(nogitState, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: nogitDir }));
      const g = evaluateReceiptGate(nogitState, nogitDir);
      expect(g.status).toBe("green");
      expect(g.allowExit).toBe(true);
      expect(g.degraded).toBe(true);
    });

    it("blocks when a no-git green receipt exceeds the short window", () => {
      const past = Date.now() - (NO_GIT_FRESHNESS_MS + 30_000);
      writeReceiptFile(nogitState, buildReceipt({ cmd: "true", exitCode: 0, tail: "ok", directory: nogitDir, now: past }));
      const g = evaluateReceiptGate(nogitState, nogitDir);
      expect(g.status).toBe("stale-time");
      expect(g.allowExit).toBe(false);
    });
  });
});
