import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function loadDbModule(tempHome: string) {
  process.env.OPENZCA_HOME = tempHome;
  const moduleUrl = `${pathToFileURL(path.join(repoRoot, "src/lib/db.ts")).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("db help lists grouped subcommands", () => {
  const result = runCli(["db", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\breset\b/);
  assert.match(result.stdout, /\bme\b/);
  assert.match(result.stdout, /\bgroup\b/);
  assert.match(result.stdout, /\bfriend\b/);
  assert.match(result.stdout, /\bchat\b/);
  assert.match(result.stdout, /\bmessage\b/);
  assert.match(result.stdout, /\bsync\b/);
});

test("db reset requires --yes", () => {
  const result = runCli(["db", "reset"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing destructive operation without --yes in non-interactive mode/);
});

test("db group help lists list info members and messages", () => {
  const result = runCli(["db", "group", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\blist\b/);
  assert.match(result.stdout, /\binfo\b/);
  assert.match(result.stdout, /\bmembers\b/);
  assert.match(result.stdout, /\bmessages\b/);
});

test("db friend help lists list find info and messages", () => {
  const result = runCli(["db", "friend", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\blist\b/);
  assert.match(result.stdout, /\bfind\b/);
  assert.match(result.stdout, /\binfo\b/);
  assert.match(result.stdout, /\bmessages\b/);
});

test("db chat help lists list info and messages", () => {
  const result = runCli(["db", "chat", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\blist\b/);
  assert.match(result.stdout, /\binfo\b/);
  assert.match(result.stdout, /\bmessages\b/);
});

test("db me help lists info and id", () => {
  const result = runCli(["db", "me", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\binfo\b/);
  assert.match(result.stdout, /\bid\b/);
});

test("db group messages help describes since as duration and from/to as boundaries", () => {
  const result = runCli(["db", "group", "messages", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--since <duration>/);
  assert.match(result.stdout, /--from <time>/);
  assert.match(result.stdout, /--to <time>/);
  assert.match(result.stdout, /--all/);
  assert.match(result.stdout, /--oldest-first/);
});

test("db sync help lists the nested sync modes", () => {
  const result = runCli(["db", "sync", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\(default: 200\) \(default: "200"\)/);
  assert.match(result.stdout, /\ball\b/);
  assert.match(result.stdout, /\bgroups\b/);
  assert.match(result.stdout, /\bfriends\b/);
  assert.match(result.stdout, /\bchats\b/);
  assert.match(result.stdout, /\bgroup\b/);
  assert.match(result.stdout, /\bchat\b/);
});

test("db group messages rejects mixing since and from", () => {
  const result = runCli([
    "db",
    "group",
    "messages",
    "123",
    "--since",
    "24h",
    "--from",
    "2026-03-21",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use either --since/);
});

test("db group messages rejects non-duration since values", () => {
  const result = runCli([
    "db",
    "group",
    "messages",
    "123",
    "--since",
    "today",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--since must be a relative duration/);
});

test("db group messages rejects keyword boundaries like today", () => {
  const result = runCli([
    "db",
    "group",
    "messages",
    "123",
    "--from",
    "today",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--from must be an ISO timestamp, a date, or unix seconds\/ms/);
});

test("db group messages rejects mixing all and limit", () => {
  const result = runCli([
    "db",
    "group",
    "messages",
    "123",
    "--all",
    "--limit",
    "10",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use either --all or --limit/);
});

test("db chat messages infers stored group thread type", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-cli-db-"));
  const profile = "cli-db";
  const env = { OPENZCA_HOME: tempHome };
  const db = await loadDbModule(tempHome);

  t.after(async () => {
    delete process.env.OPENZCA_HOME;
    try {
      await db.closeDb(profile);
    } catch {
      // ignore cleanup failures in test teardown
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  const addProfile = runCli(["account", "add", profile], env);
  assert.equal(addProfile.status, 0, addProfile.stderr);

  await db.enableDb(profile);
  await db.persistThread({
    profile,
    scopeThreadId: "g1",
    rawThreadId: "g1",
    threadType: "group",
    title: "Group 1",
  });
  await db.replaceThreadMembers(profile, "g1", [
    {
      profile,
      scopeThreadId: "g1",
      userId: "u1",
      displayName: "Alice",
      zaloName: "Alice",
      snapshotAtMs: 1_700_000_000_000,
    },
  ]);
  await db.persistMessage({
    profile,
    scopeThreadId: "g1",
    rawThreadId: "g1",
    threadType: "group",
    msgId: "m1",
    cliMsgId: "c1",
    senderId: "u1",
    senderName: "",
    toId: "g1",
    timestampMs: 1_700_000_000_000,
    msgType: "webchat",
    contentText: "hello",
    source: "sync_group",
    rawMessageJson: JSON.stringify({ msgId: "m1" }),
  });
  await db.closeDb(profile);

  const result = runCli(["-p", profile, "db", "chat", "messages", "g1"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /threadType: 'group'/);
  assert.match(result.stdout, /count: 1/);
  assert.match(result.stdout, /msgId: 'm1'/);

  const aliasResult = runCli(["-p", profile, "db", "chat", "g1"], env);

  assert.equal(aliasResult.status, 0, aliasResult.stderr);
  assert.match(aliasResult.stdout, /threadType: 'group'/);
  assert.match(aliasResult.stdout, /count: 1/);
  assert.match(aliasResult.stdout, /msgId: 'm1'/);
});
