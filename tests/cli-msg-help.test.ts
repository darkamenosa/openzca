import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [tsxCliPath, "src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("msg send help lists reply-id and reply-message options", () => {
  const result = runCli(["msg", "send", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--reply-id <id>/);
  assert.match(result.stdout, /--reply-message <json>/);
});

test("msg analyze-text help lists raw and json options", () => {
  const result = runCli(["msg", "analyze-text", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--raw/);
  assert.match(result.stdout, /--json/);
});

test("msg analyze-text returns json analysis for formatted text without auth", () => {
  const result = runCli(["msg", "analyze-text", "123", "**hi**", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    rawInputLength: number;
    renderedTextLength: number;
    styleCount: number;
    textPropertiesLength: number;
    sendPath: string;
    payloadObject: { msg: string; styles?: Array<{ st: string; start: number; len: number }> };
  };

  assert.equal(payload.rawInputLength, 6);
  assert.equal(payload.renderedTextLength, 2);
  assert.equal(payload.styleCount, 1);
  assert.equal(payload.sendPath, "sms");
  assert.equal(payload.payloadObject.msg, "hi");
  assert.deepStrictEqual(payload.payloadObject.styles, [{ start: 0, len: 2, st: "b" }]);
  assert.ok(payload.textPropertiesLength > 0);
});
