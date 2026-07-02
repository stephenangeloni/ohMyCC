#!/usr/bin/env node

/**
 * verify-gate — run the repo's verify command and stamp a verification receipt.
 *
 * The receipt's green/red verdict is derived from the command's PROCESS EXIT
 * CODE, never from a model claim. This is the producer half of the loop
 * completion gate; the consumer half is evaluateReceiptGate() in
 * lib/verification-receipt.mjs, called by the Stop hook / cancel path.
 *
 * Usage:
 *   node verify-gate.mjs ["<verify command>"]
 * If no command is passed, it is resolved from .claude/omc.jsonc `verify`
 * then project-memory build.{test,lint,build}Command.
 *
 * The process exits with the verify command's exit code (0 green, nonzero red)
 * so it composes in shell pipelines too.
 *
 * Security note: the verify command is intentionally run through a shell
 * (execSync) because it is an operator-provided command string that may use
 * shell operators (e.g. "pnpm test && pnpm lint"). It is configuration, not
 * untrusted input.
 */

import { execSync } from "child_process";
import { join } from "path";
import { resolveOmcStateRoot } from "./lib/state-root.mjs";
import {
  resolveVerifyCommand,
  buildReceipt,
  writeReceiptFile,
} from "./lib/verification-receipt.mjs";

async function main() {
  const directory = process.cwd();
  const cliCmd = process.argv[2] && process.argv[2].trim();
  const cmd = cliCmd || resolveVerifyCommand(directory);

  if (!cmd) {
    console.error(
      "[verify-gate] No verify command given or configured. " +
        "Pass one as an argument, or set `verify` in .claude/omc.jsonc " +
        "(or test/build/lint commands in project-memory).",
    );
    process.exit(2);
  }

  const omcRoot = await resolveOmcStateRoot(directory);
  const stateDir = join(omcRoot, "state");

  let exitCode = 0;
  let out = "";
  try {
    out = execSync(cmd, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    exitCode = typeof error?.status === "number" ? error.status : 1;
    out = `${error?.stdout || ""}${error?.stderr || ""}`;
  }

  const receipt = buildReceipt({ cmd, exitCode, tail: out, directory });
  const receiptPath = writeReceiptFile(stateDir, receipt);

  console.log(
    `[verify-gate] ${exitCode === 0 ? "GREEN" : "RED"} (exit ${exitCode}) ` +
      `for \`${cmd}\` — receipt: ${receiptPath}`,
  );
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[verify-gate] ${error?.message || error}`);
  process.exit(1);
});
