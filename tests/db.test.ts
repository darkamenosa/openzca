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

test("findContacts matches accent-insensitive names", { concurrency: false }, async (t) => {
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
  await db.persistContact({
    profile,
    userId: "u1",
    displayName: "Thư",
    zaloName: "Thư",
    relationship: "seen_dm",
    rawJson: JSON.stringify({ userId: "u1", displayName: "Thư" }),
  });

  const rows = await db.findContacts({ profile, query: "thu" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "u1");
  assert.equal(rows[0].relationship, "seen_dm");
});

test("findContacts supports simple glob patterns", { concurrency: false }, async (t) => {
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
  await db.persistContact({
    profile,
    userId: "u1",
    displayName: "Thư",
    zaloName: "Thư",
    relationship: "seen_group",
    rawJson: JSON.stringify({ userId: "u1", displayName: "Thư" }),
  });

  const containsRows = await db.findContacts({ profile, query: "*Thư*" });
  assert.equal(containsRows.length, 1);
  assert.equal(containsRows[0].userId, "u1");

  const prefixRows = await db.findContacts({ profile, query: "Th*" });
  assert.equal(prefixRows.length, 1);
  assert.equal(prefixRows[0].userId, "u1");
});

test("getDb reopens after a worker starts closing", { concurrency: false }, async (t) => {
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
  const firstHandle = await db.getDb(profile);
  const closing = firstHandle.close();
  const reopenedHandle = await db.getDb(profile);

  assert.notEqual(reopenedHandle, firstHandle);

  await closing;
  await db.persistContact({
    profile,
    userId: "u1",
    displayName: "Alice",
    relationship: "seen_dm",
  });

  const rows = await db.findContacts({ profile, query: "alice" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "u1");
});

test("legacy friends migrate into contacts on reopen", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  const configPath = db.getDbConfigPath(profile);
  const profileDir = path.dirname(configPath);
  const dbPath = path.join(profileDir, "messages.sqlite");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ enabled: true, updatedAt: "2026-03-27T00:00:00.000Z" })}\n`,
    "utf8",
  );

  const { DatabaseSync } = await import("node:sqlite");
  const seedDb = new DatabaseSync(dbPath);
  seedDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends (
      profile TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, user_id)
    );
    CREATE TABLE IF NOT EXISTS thread_members (
      profile TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      member_type INTEGER,
      raw_json TEXT,
      snapshot_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, scope_thread_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS threads (
      profile TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      raw_thread_id TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      peer_id TEXT,
      title TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, scope_thread_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      profile TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      raw_thread_id TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      msg_id TEXT,
      cli_msg_id TEXT,
      action_id TEXT,
      sender_id TEXT,
      sender_name TEXT,
      to_id TEXT,
      timestamp_ms INTEGER NOT NULL,
      msg_type TEXT,
      content_text TEXT,
      content_json TEXT,
      quote_msg_id TEXT,
      quote_cli_msg_id TEXT,
      quote_owner_id TEXT,
      quote_text TEXT,
      source TEXT NOT NULL,
      raw_message_json TEXT,
      raw_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, message_uid)
    );
    CREATE TABLE IF NOT EXISTS contacts (
      profile TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      relationship TEXT NOT NULL DEFAULT 'unknown',
      first_seen_at_ms INTEGER,
      last_seen_at_ms INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, user_id)
    );
  `);
  seedDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("001", "2026-03-27T00:00:00.000Z");
  seedDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("002", "2026-03-27T00:00:00.000Z");
  seedDb.prepare(`
    INSERT INTO friends (
      profile, user_id, display_name, zalo_name, avatar, account_status, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile,
    "u-legacy",
    "Legacy User",
    "Legacy Zalo",
    "https://example.com/avatar.jpg",
    1,
    JSON.stringify({ userId: "u-legacy", displayName: "Legacy User" }),
    "2026-03-27T00:00:00.000Z",
    "2026-03-27T00:00:00.000Z",
  );
  seedDb.close();

  const contacts = await db.listContacts({ profile });
  const legacy = contacts.find((row: { userId: string }) => row.userId === "u-legacy");
  assert.ok(legacy);
  assert.equal(legacy.relationship, "friend");
  assert.equal(legacy.displayName, "Legacy User");
});

test("legacy group members and dm threads backfill contacts on reopen", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  const configPath = db.getDbConfigPath(profile);
  const profileDir = path.dirname(configPath);
  const dbPath = path.join(profileDir, "messages.sqlite");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ enabled: true, updatedAt: "2026-03-27T00:00:00.000Z" })}\n`,
    "utf8",
  );

  const { DatabaseSync } = await import("node:sqlite");
  const seedDb = new DatabaseSync(dbPath);
  seedDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends (
      profile TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, user_id)
    );
    CREATE TABLE IF NOT EXISTS thread_members (
      profile TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      member_type INTEGER,
      raw_json TEXT,
      snapshot_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, scope_thread_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS threads (
      profile TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      raw_thread_id TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      peer_id TEXT,
      title TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, scope_thread_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      profile TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      raw_thread_id TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      msg_id TEXT,
      cli_msg_id TEXT,
      action_id TEXT,
      sender_id TEXT,
      sender_name TEXT,
      to_id TEXT,
      timestamp_ms INTEGER NOT NULL,
      msg_type TEXT,
      content_text TEXT,
      content_json TEXT,
      quote_msg_id TEXT,
      quote_cli_msg_id TEXT,
      quote_owner_id TEXT,
      quote_text TEXT,
      source TEXT NOT NULL,
      raw_message_json TEXT,
      raw_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, message_uid)
    );
    CREATE TABLE IF NOT EXISTS contacts (
      profile TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      zalo_name TEXT,
      avatar TEXT,
      account_status INTEGER,
      relationship TEXT NOT NULL DEFAULT 'unknown',
      first_seen_at_ms INTEGER,
      last_seen_at_ms INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, user_id)
    );
  `);
  seedDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("001", "2026-03-27T00:00:00.000Z");
  seedDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("002", "2026-03-27T00:00:00.000Z");
  seedDb.prepare(`
    INSERT INTO thread_members (
      profile, scope_thread_id, user_id, display_name, zalo_name, avatar,
      account_status, member_type, raw_json, snapshot_at_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile,
    "g1",
    "u-group",
    "Group Person",
    "Group Person",
    "https://example.com/group.jpg",
    1,
    0,
    JSON.stringify({ userId: "u-group", displayName: "Group Person" }),
    1_700_000_000_000,
    "2026-03-27T00:00:00.000Z",
    "2026-03-27T00:00:00.000Z",
  );
  seedDb.prepare(`
    INSERT INTO threads (
      profile, scope_thread_id, raw_thread_id, thread_type, peer_id, title,
      is_pinned, is_hidden, is_archived, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile,
    "u-dm",
    "u-dm",
    "user",
    "u-dm",
    "DM Person",
    0,
    0,
    0,
    JSON.stringify({ userId: "u-dm", displayName: "DM Person" }),
    "2026-03-27T00:00:00.000Z",
    "2026-03-27T00:00:00.000Z",
  );
  seedDb.prepare(`
    INSERT INTO messages (
      profile, message_uid, scope_thread_id, raw_thread_id, thread_type,
      msg_id, cli_msg_id, action_id, sender_id, sender_name, to_id,
      timestamp_ms, msg_type, content_text, content_json,
      quote_msg_id, quote_cli_msg_id, quote_owner_id, quote_text,
      source, raw_message_json, raw_payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile,
    "u-dm:msg:m1",
    "u-dm",
    "u-dm",
    "user",
    "m1",
    "c1",
    null,
    "u-dm",
    "DM Person",
    "self-1",
    1_700_000_100_000,
    "chat.text",
    "hello",
    null,
    null,
    null,
    null,
    null,
    "listen",
    JSON.stringify({ msgId: "m1" }),
    null,
    "2026-03-27T00:00:00.000Z",
    "2026-03-27T00:00:00.000Z",
  );
  seedDb.close();

  const contacts = await db.listContacts({ profile });
  const groupContact = contacts.find((row: { userId: string }) => row.userId === "u-group");
  const dmContact = contacts.find((row: { userId: string }) => row.userId === "u-dm");
  assert.ok(groupContact);
  assert.equal(groupContact.relationship, "seen_group");
  assert.ok(dmContact);
  assert.equal(dmContact.relationship, "seen_dm");
  assert.equal(dmContact.displayName, "DM Person");
});

test("friend compatibility reads from contacts filtered by relationship", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = "test-profile";
  const unique = Math.random().toString(36).slice(2, 10);
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
  await db.persistContact({
    profile,
    userId: `u-friend-${unique}`,
    displayName: `Alice ${unique}`,
    relationship: "friend",
  });
  await db.persistContact({
    profile,
    userId: `u-stranger-${unique}`,
    displayName: `Bob ${unique}`,
    relationship: "seen_dm",
  });

  const rows = await db.findFriends({ profile, query: unique });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, `u-friend-${unique}`);
  assert.equal(rows[0].relationship, "friend");
});

test("contact queries choose one active DM thread per user", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  await db.persistContact({
    profile,
    userId: "u1",
    displayName: "Alice",
    relationship: "seen_dm",
  });
  await db.persistThread({
    profile,
    scopeThreadId: "legacy-u1",
    rawThreadId: "legacy-u1",
    threadType: "user",
    peerId: "u1",
    title: "Legacy Alice",
  });
  await db.persistMessage({
    profile,
    scopeThreadId: "legacy-u1",
    rawThreadId: "legacy-u1",
    threadType: "user",
    peerId: "u1",
    msgId: "m1",
    cliMsgId: "c1",
    senderId: "u1",
    senderName: "Alice",
    toId: "self-1",
    timestampMs: 1_700_000_000_000,
    msgType: "chat.text",
    contentText: "hello",
    source: "listen",
  });
  await db.persistThread({
    profile,
    scopeThreadId: "u1",
    rawThreadId: "u1",
    threadType: "user",
    peerId: "u1",
    title: "Canonical Alice",
  });

  const contacts = await db.listContacts({ profile });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0]?.userId, "u1");
  assert.equal(contacts[0]?.chatId, "legacy-u1");
  assert.equal(contacts[0]?.title, "Legacy Alice");

  const info = await db.getContactInfo({ profile, userId: "u1" });
  assert.ok(info);
  assert.equal(info.chatId, "legacy-u1");
  assert.equal(info.title, "Legacy Alice");
  assert.equal(info.messageCount, 1);
});

test("reconcileFriendRelationships downgrades stale friends from current sync", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  await db.persistContact({
    profile,
    userId: "u-friend-keep",
    displayName: "Keep Friend",
    relationship: "friend",
  });
  await db.persistContact({
    profile,
    userId: "u-friend-dm",
    displayName: "DM Friend",
    relationship: "friend",
  });
  await db.persistThread({
    profile,
    scopeThreadId: "u-friend-dm",
    rawThreadId: "u-friend-dm",
    threadType: "user",
    peerId: "u-friend-dm",
    title: "DM Friend",
  });
  await db.persistContact({
    profile,
    userId: "u-friend-group",
    displayName: "Group Friend",
    relationship: "friend",
  });
  await db.replaceThreadMembers(profile, "g1", [
    {
      profile,
      scopeThreadId: "g1",
      userId: "u-friend-group",
      displayName: "Group Friend",
      snapshotAtMs: 1_700_000_000_000,
    },
  ]);
  await db.persistContact({
    profile,
    userId: "u-friend-none",
    displayName: "No Longer Friend",
    relationship: "friend",
  });

  await db.reconcileFriendRelationships({
    profile,
    currentFriendIds: ["u-friend-keep"],
  });

  const keep = await db.getFriendInfo({ profile, userId: "u-friend-keep" });
  assert.ok(keep);

  const dm = await db.getContactInfo({ profile, userId: "u-friend-dm" });
  assert.equal(dm?.relationship, "seen_dm");

  const group = await db.getContactInfo({ profile, userId: "u-friend-group" });
  assert.equal(group?.relationship, "seen_group");

  const none = await db.getContactInfo({ profile, userId: "u-friend-none" });
  assert.equal(none?.relationship, "unknown");
});

test("Database.close is idempotent", { concurrency: false }, async (t) => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-db-test-"));
  const profile = "test-profile";
  const db = await loadDbModule(tempHome);

  t.after(async () => {
    delete process.env.OPENZCA_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  await db.enableDb(profile);
  const handle = await db.getDb(profile);

  await Promise.all([handle.close(), handle.close()]);
});
