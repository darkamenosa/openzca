import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadDbModule(tempHome: string) {
  process.env.OPENZCA_HOME = tempHome;
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), "src/lib/db.ts")).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("resolveScopeThreadId keeps a stable DM peer id", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  t.after(async () => {
    delete process.env.OPENZCA_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  const db = await loadDbModule(tempHome);

  assert.equal(
    db.resolveScopeThreadId({
      threadType: "user",
      rawThreadId: "self-1",
      senderId: "self-1",
      toId: "peer-9",
      selfId: "self-1",
    }),
    "peer-9",
  );

  assert.equal(
    db.resolveScopeThreadId({
      threadType: "user",
      rawThreadId: "peer-9",
      senderId: "peer-9",
      toId: "self-1",
      selfId: "self-1",
    }),
    "peer-9",
  );
});

test("persistMessage writes async rows that db recent returns newest-first", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = "test-profile";
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

  await db.enableDb(profile);

  await db.persistMessage(
    db.normalizeInboundListenRecord({
      profile,
      threadType: "user",
      rawThreadId: "peer-1",
      senderId: "peer-1",
      toId: "self-1",
      selfId: "self-1",
      msgId: "m1",
      cliMsgId: "c1",
      timestampMs: 1_700_000_000_000,
      msgType: "chat.text",
      contentText: "older",
      source: "listen",
      rawMessage: { msgId: "m1" },
    }),
  );

  await db.persistMessage(
    db.normalizeInboundListenRecord({
      profile,
      threadType: "user",
      rawThreadId: "peer-1",
      senderId: "peer-1",
      toId: "self-1",
      selfId: "self-1",
      msgId: "m2",
      cliMsgId: "c2",
      timestampMs: 1_700_000_100_000,
      msgType: "chat.text",
      contentText: "newer",
      source: "listen",
      rawMessage: { msgId: "m2" },
    }),
  );

  const rows = await db.listRecentMessages({
    profile,
    threadId: "peer-1",
    threadType: "user",
    count: 10,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].msgId, "m2");
  assert.equal(rows[0].content, "newer");
  assert.equal(rows[1].msgId, "m1");
  assert.equal(rows[1].content, "older");
});

test("findFriends matches accent-insensitive names", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = "test-profile";
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

  await db.enableDb(profile);
  await db.persistFriend({
    profile,
    userId: "u1",
    displayName: "Thư",
    zaloName: "Thư",
    rawJson: JSON.stringify({ userId: "u1", displayName: "Thư" }),
  });

  const rows = await db.findFriends({ profile, query: "thu" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "u1");
});

test("findFriends supports simple glob patterns", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = "test-profile";
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

  await db.enableDb(profile);
  await db.persistFriend({
    profile,
    userId: "u1",
    displayName: "Thư",
    zaloName: "Thư",
    rawJson: JSON.stringify({ userId: "u1", displayName: "Thư" }),
  });

  const containsRows = await db.findFriends({ profile, query: "*Thư*" });
  assert.equal(containsRows.length, 1);
  assert.equal(containsRows[0].userId, "u1");

  const prefixRows = await db.findFriends({ profile, query: "Th*" });
  assert.equal(prefixRows.length, 1);
  assert.equal(prefixRows[0].userId, "u1");
});
