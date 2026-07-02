import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.unmock("child_process");
vi.unmock("node:child_process");

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyEvaluatorPath,
  isEvaluatorEditTool,
  extractEditPaths,
  resolveSealMode,
  evaluateEvaluatorSeal,
  // @ts-expect-error — plain .mjs lib, no type declarations
} from "../../scripts/lib/evaluator-seal.mjs";

const SCRIPT_PATH = join(process.cwd(), "scripts", "pre-tool-enforcer.mjs");

function writeJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Unit tests — pure classification / mode-resolution logic
// ---------------------------------------------------------------------------

describe("evaluator-seal: classifyEvaluatorPath", () => {
  it("classifies test files", () => {
    expect(classifyEvaluatorPath("src/foo.test.ts")).toBe("test");
    expect(classifyEvaluatorPath("src/foo.spec.js")).toBe("test");
    expect(classifyEvaluatorPath("packages/x/bar.test.tsx")).toBe("test");
    expect(classifyEvaluatorPath("scripts/thing.test.mjs")).toBe("test");
    expect(classifyEvaluatorPath("src/__tests__/util.ts")).toBe("test");
    expect(classifyEvaluatorPath("e2e/login.ts")).toBe("test");
    expect(classifyEvaluatorPath("tests/helpers.js")).toBe("test");
    // Windows separators normalize.
    expect(classifyEvaluatorPath("src\\a\\b.test.ts")).toBe("test");
  });

  it("classifies CI files", () => {
    expect(classifyEvaluatorPath(".github/workflows/ci.yml")).toBe("ci");
    expect(classifyEvaluatorPath("repo/.github/workflows/release.yaml")).toBe("ci");
    expect(classifyEvaluatorPath(".gitlab-ci.yml")).toBe("ci");
    expect(classifyEvaluatorPath("Jenkinsfile")).toBe("ci");
    expect(classifyEvaluatorPath(".circleci/config.yml")).toBe("ci");
  });

  it("classifies the gate's own machinery", () => {
    expect(classifyEvaluatorPath("scripts/verify-gate.mjs")).toBe("gate-machinery");
    expect(classifyEvaluatorPath("scripts/lib/verification-receipt.mjs")).toBe(
      "gate-machinery",
    );
    expect(
      classifyEvaluatorPath(".omc/state/verification-receipt.json"),
    ).toBe("gate-machinery");
  });

  it("returns null for ordinary source, docs, and config", () => {
    expect(classifyEvaluatorPath("src/app.ts")).toBeNull();
    expect(classifyEvaluatorPath("README.md")).toBeNull();
    expect(classifyEvaluatorPath("package.json")).toBeNull();
    // 'latest' must not match the /test/ directory rule.
    expect(classifyEvaluatorPath("src/latest/index.ts")).toBeNull();
    // A source file named verify-gate elsewhere is not the real machinery path.
    expect(classifyEvaluatorPath("src/verify-gate.mjs")).toBeNull();
    expect(classifyEvaluatorPath("")).toBeNull();
    expect(classifyEvaluatorPath(null as unknown as string)).toBeNull();
  });
});

describe("evaluator-seal: isEvaluatorEditTool", () => {
  it("matches structured edit tools only", () => {
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      expect(isEvaluatorEditTool(t)).toBe(true);
    }
    for (const t of ["Bash", "Read", "Task", "Agent", "Grep"]) {
      expect(isEvaluatorEditTool(t)).toBe(false);
    }
  });
});

describe("evaluator-seal: extractEditPaths", () => {
  it("pulls file_path / notebook_path", () => {
    expect(extractEditPaths({ file_path: "a/b.test.ts" })).toEqual(["a/b.test.ts"]);
    expect(extractEditPaths({ notebook_path: "nb.ipynb" })).toEqual(["nb.ipynb"]);
    expect(extractEditPaths({})).toEqual([]);
    expect(extractEditPaths(null)).toEqual([]);
  });
});

describe("evaluator-seal: resolveSealMode", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seal-mode-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to warn with no env and no config", () => {
    expect(resolveSealMode(dir, {})).toBe("warn");
  });

  it("honors the env override (off/warn/deny + aliases)", () => {
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "off" })).toBe("off");
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "0" })).toBe("off");
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "warn" })).toBe("warn");
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "deny" })).toBe("deny");
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "1" })).toBe("deny");
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "strict" })).toBe("deny");
  });

  it("reads sealEvaluator from .claude/omc.jsonc", () => {
    writeJson(join(dir, ".claude", "omc.jsonc"), { sealEvaluator: true });
    expect(resolveSealMode(dir, {})).toBe("deny");
  });

  it("lets env win over config", () => {
    writeJson(join(dir, ".claude", "omc.jsonc"), { sealEvaluator: true });
    expect(resolveSealMode(dir, { OMC_SEAL_EVALUATOR: "warn" })).toBe("warn");
  });

  it("treats sealEvaluator:false as fully off", () => {
    writeJson(join(dir, ".claude", "omc.jsonc"), { sealEvaluator: false });
    expect(resolveSealMode(dir, {})).toBe("off");
  });
});

describe("evaluator-seal: evaluateEvaluatorSeal", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seal-eval-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no loop is active", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Edit",
      toolInput: { file_path: "a.test.ts" },
      modeActive: false,
      directory: dir,
      env: {},
    });
    expect(r).toBeNull();
  });

  it("returns null for a non-edit tool", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Bash",
      toolInput: { command: "echo hi > a.test.ts" },
      modeActive: true,
      directory: dir,
      env: {},
    });
    expect(r).toBeNull();
  });

  it("returns null for an ordinary source edit", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Edit",
      toolInput: { file_path: "src/app.ts" },
      modeActive: true,
      directory: dir,
      env: {},
    });
    expect(r).toBeNull();
  });

  it("warns (default) on a test-file edit during an active loop", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Edit",
      toolInput: { file_path: "src/app.test.ts" },
      modeActive: true,
      directory: dir,
      env: {},
    });
    expect(r).toMatchObject({ level: "warn", category: "test" });
    expect(String(r.reason)).toContain("EVALUATOR SEAL");
  });

  it("denies gate-machinery edits when strict mode is opted in", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Write",
      toolInput: { file_path: "scripts/verify-gate.mjs" },
      modeActive: true,
      directory: dir,
      env: { OMC_SEAL_EVALUATOR: "deny" },
    });
    expect(r).toMatchObject({ level: "deny", category: "gate-machinery" });
    expect(String(r.reason)).toContain("EVALUATOR SEAL");
  });

  it("returns null when the seal is turned off", () => {
    const r = evaluateEvaluatorSeal({
      toolName: "Edit",
      toolInput: { file_path: "src/app.test.ts" },
      modeActive: true,
      directory: dir,
      env: { OMC_SEAL_EVALUATOR: "off" },
    });
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Runtime tests — the seal wired into scripts/pre-tool-enforcer.mjs
// ---------------------------------------------------------------------------

describe("evaluator-seal runtime (pre-tool-enforcer.mjs)", () => {
  let tempDir: string;

  function runHook(
    input: Record<string, unknown>,
    env: Record<string, string> = {},
  ): Record<string, unknown> {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempDir,
      input: JSON.stringify(input),
      encoding: "utf-8",
      timeout: 6000,
      env: {
        ...process.env,
        HOME: join(tempDir, ".test-home"),
        CLAUDE_CONFIG_DIR: join(tempDir, ".test-home", ".claude"),
        NODE_ENV: "test",
        DISABLE_OMC: "",
        OMC_SKIP_HOOKS: "",
        OMC_SEAL_EVALUATOR: "",
        ...env,
      },
    });
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  }

  function activateRalphLoop(): void {
    writeJson(join(tempDir, ".omc", "state", "ralph-state.json"), {
      active: true,
      iteration: 1,
      started_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    });
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "seal-runtime-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("hard-denies a test-file edit during an active loop when OMC_SEAL_EVALUATOR=deny", () => {
    activateRalphLoop();
    const out = runHook(
      { tool_name: "Edit", tool_input: { file_path: join(tempDir, "src/app.test.ts") } },
      { OMC_SEAL_EVALUATOR: "deny" },
    );
    const hs = out.hookSpecificOutput as Record<string, unknown>;
    expect(hs?.permissionDecision).toBe("deny");
    expect(String(hs?.permissionDecisionReason)).toContain("EVALUATOR SEAL");
  });

  it("warns (default) but does NOT deny a test-file edit during an active loop", () => {
    activateRalphLoop();
    const out = runHook({
      tool_name: "Edit",
      tool_input: { file_path: join(tempDir, "src/app.test.ts") },
    });
    const hs = out.hookSpecificOutput as Record<string, unknown>;
    expect(hs?.permissionDecision).toBeUndefined();
    expect(String(hs?.additionalContext)).toContain("EVALUATOR SEAL");
  });

  it("does not fire when no loop is active", () => {
    const out = runHook(
      { tool_name: "Edit", tool_input: { file_path: join(tempDir, "src/app.test.ts") } },
      { OMC_SEAL_EVALUATOR: "deny" },
    );
    const hs = (out.hookSpecificOutput as Record<string, unknown>) || {};
    expect(hs.permissionDecision).toBeUndefined();
    expect(String(hs.additionalContext || "")).not.toContain("EVALUATOR SEAL");
  });

  it("hard-denies a MultiEdit to gate machinery during an active loop (deny mode)", () => {
    activateRalphLoop();
    const out = runHook(
      {
        tool_name: "MultiEdit",
        tool_input: {
          file_path: join(tempDir, "scripts/verify-gate.mjs"),
          edits: [{ old_string: "a", new_string: "b" }],
        },
      },
      { OMC_SEAL_EVALUATOR: "deny" },
    );
    const hs = out.hookSpecificOutput as Record<string, unknown>;
    expect(hs?.permissionDecision).toBe("deny");
    expect(String(hs?.permissionDecisionReason)).toContain("gate-machinery");
  });

  it("does not fire for ordinary source edits during an active loop", () => {
    activateRalphLoop();
    const out = runHook(
      { tool_name: "Edit", tool_input: { file_path: join(tempDir, "src/app.ts") } },
      { OMC_SEAL_EVALUATOR: "deny" },
    );
    const hs = (out.hookSpecificOutput as Record<string, unknown>) || {};
    expect(hs.permissionDecision).toBeUndefined();
    expect(String(hs.additionalContext || "")).not.toContain("EVALUATOR SEAL");
  });
});
