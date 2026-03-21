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

function runTsxEval(source: string, env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [tsxCliPath, "--eval", source], {
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

test("db status does not create sqlite file when disabled", { concurrency: false }, async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-cli-db-status-"));
  const profile = "db-status";
  const env = { OPENZCA_HOME: tempHome };

  try {
    const addProfile = runCli(["account", "add", profile], env);
    assert.equal(addProfile.status, 0, addProfile.stderr);

    const result = runCli(["--profile", profile, "db", "status", "-j"], env);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout) as { exists: boolean };
    assert.equal(payload.exists, false);

    await assert.rejects(
      fs.access(path.join(tempHome, "profiles", profile, "messages.sqlite")),
      /ENOENT/,
    );
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
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

test("db chat subcommands honor -j JSON output", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-cli-db-chat-json-"));
  const profile = "cli-db-json";
  const env = { OPENZCA_HOME: tempHome };

  t.after(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  const addProfile = runCli(["account", "add", profile], env);
  assert.equal(addProfile.status, 0, addProfile.stderr);

  const seedResult = runTsxEval(
    `
      import { enableDb, persistThread, persistMessage, closeDb } from "./src/lib/db.ts";
      (async () => {
        await enableDb(${JSON.stringify(profile)});
        await persistThread({
          profile: ${JSON.stringify(profile)},
          scopeThreadId: "u1",
          rawThreadId: "u1",
          threadType: "user",
          peerId: "u1",
          title: "Alice",
        });
        await persistMessage({
          profile: ${JSON.stringify(profile)},
          scopeThreadId: "u1",
          rawThreadId: "u1",
          threadType: "user",
          msgId: "m1",
          cliMsgId: "c1",
          senderId: "u1",
          senderName: "Alice",
          toId: "self-1",
          timestampMs: 1700000000000,
          msgType: "chat.text",
          contentText: "hello",
          source: "listen",
          rawMessageJson: JSON.stringify({ msgId: "m1" }),
        });
        await closeDb(${JSON.stringify(profile)});
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `,
    env,
  );
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const listResult = runCli(["--profile", profile, "db", "chat", "list", "-j"], env);
  assert.equal(listResult.status, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout) as Array<{ threadId: string }>;
  assert.equal(listPayload[0]?.threadId, "u1");

  const infoResult = runCli(["--profile", profile, "db", "chat", "info", "u1", "-j"], env);
  assert.equal(infoResult.status, 0, infoResult.stderr);
  const infoPayload = JSON.parse(infoResult.stdout) as { threadId: string };
  assert.equal(infoPayload.threadId, "u1");

  const messagesResult = runCli(
    ["--profile", profile, "db", "chat", "messages", "u1", "-j"],
    env,
  );
  assert.equal(messagesResult.status, 0, messagesResult.stderr);
  const messagesPayload = JSON.parse(messagesResult.stdout) as {
    chatId: string;
    count: number;
    messages: Array<{ msgId: string }>;
  };
  assert.equal(messagesPayload.chatId, "u1");
  assert.equal(messagesPayload.count, 1);
  assert.equal(messagesPayload.messages[0]?.msgId, "m1");
});

test("db chat <id> aliases to db chat messages <id>", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-cli-test-"));
  const profile = "test-profile";
  const env = { ...process.env, OPENZCA_HOME: tempHome };

  t.after(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  const addProfile = runCli(["account", "add", profile], env);
  assert.equal(addProfile.status, 0, addProfile.stderr);

  const seedResult = runTsxEval(
    `
      (async () => {
        const { enableDb, persistThread, persistMessage, closeDb } = await import(${JSON.stringify(
          pathToFileURL(path.join(process.cwd(), "src/lib/db.ts")).href,
        )});
        await enableDb(${JSON.stringify(profile)});
        await persistThread({
          profile: ${JSON.stringify(profile)},
          scopeThreadId: "u1",
          rawThreadId: "u1",
          threadType: "user",
          peerId: "u1",
          title: "Alice",
        });
        await persistMessage({
          profile: ${JSON.stringify(profile)},
          scopeThreadId: "u1",
          rawThreadId: "u1",
          threadType: "user",
          msgId: "m1",
          cliMsgId: "c1",
          senderId: "u1",
          senderName: "Alice",
          toId: "self-1",
          timestampMs: 1700000000000,
          msgType: "chat.text",
          contentText: "hello",
          source: "listen",
          rawMessageJson: JSON.stringify({ msgId: "m1" }),
        });
        await closeDb(${JSON.stringify(profile)});
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `,
    env,
  );
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const aliasResult = runCli(["--profile", profile, "db", "chat", "u1", "-j"], env);
  assert.equal(aliasResult.status, 0, aliasResult.stderr);
  const aliasPayload = JSON.parse(aliasResult.stdout) as {
    chatId: string;
    count: number;
    messages: Array<{ msgId: string }>;
  };
  assert.equal(aliasPayload.chatId, "u1");
  assert.equal(aliasPayload.count, 1);
  assert.equal(aliasPayload.messages[0]?.msgId, "m1");
});
