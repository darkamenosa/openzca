import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath, "src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("group poll help lists the poll subcommands", () => {
  const result = runCli(["group", "poll", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bcreate\b/);
  assert.match(result.stdout, /\bdetail\b/);
  assert.match(result.stdout, /\bvote\b/);
  assert.match(result.stdout, /\block\b/);
  assert.match(result.stdout, /\bshare\b/);
});

test("group poll create help shows the required poll flags", () => {
  const result = runCli(["group", "poll", "create", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--question <text>/);
  assert.match(result.stdout, /--option <text>/);
  assert.match(result.stdout, /--multi/);
  assert.match(result.stdout, /--allow-add-option/);
});

test("group poll create fails locally when options are missing", () => {
  const result = runCli(["group", "poll", "create", "123", "--question", "Lunch?"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least two options/i);
  assert.doesNotMatch(result.stderr, /đăng nhập thất bại/i);
});

test("group poll vote fails locally when option ids are missing", () => {
  const result = runCli(["group", "poll", "vote", "123"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least one option id/i);
  assert.doesNotMatch(result.stderr, /đăng nhập thất bại/i);
});

test("group poll detail rejects an invalid poll id before auth", () => {
  const result = runCli(["group", "poll", "detail", "abc"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /poll id must be a positive integer/i);
  assert.doesNotMatch(result.stderr, /đăng nhập thất bại/i);
});
