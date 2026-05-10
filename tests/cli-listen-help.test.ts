import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath, "src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("listen help lists self-listen option", () => {
  const result = runCli(["listen", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--self/);
});
