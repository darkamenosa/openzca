import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";
import { getProfileDir } from "./store.js";

export type DbConfig = {
  enabled: boolean;
  path?: string;
  updatedAt: string;
};

export type DbThreadType = "group" | "user";

export type DbMention = {
  uid: string;
  pos?: number;
  len?: number;
  type?: number;
  rawJson?: string;
};

export type DbMedia = {
  mediaKind?: string;
  mediaUrl?: string;
  mediaPath?: string;
  mediaType?: string;
  rawJson?: string;
};

export type DbThreadRecord = {
  profile: string;
  scopeThreadId: string;
  rawThreadId: string;
  threadType: DbThreadType;
  peerId?: string;
  title?: string;
  isPinned?: boolean;
  isHidden?: boolean;
  isArchived?: boolean;
  rawJson?: string;
};

export type DbThreadMemberRecord = {
  profile: string;
  scopeThreadId: string;
  userId: string;
  displayName?: string;
  zaloName?: string;
  avatar?: string;
  accountStatus?: number;
  memberType?: number;
  rawJson?: string;
  snapshotAtMs: number;
};

export type DbFriendRecord = {
  profile: string;
  userId: string;
  displayName?: string;
  zaloName?: string;
  avatar?: string;
  accountStatus?: number;
  rawJson?: string;
};

export type DbMessageRecord = {
  profile: string;
  scopeThreadId: string;
  rawThreadId: string;
  threadType: DbThreadType;
  peerId?: string;
  title?: string;
  msgId?: string;
  cliMsgId?: string;
  actionId?: string;
  senderId?: string;
  senderName?: string;
  toId?: string;
  timestampMs: number;
  msgType?: string;
  contentText?: string;
  contentJson?: string;
  quoteMsgId?: string;
  quoteCliMsgId?: string;
  quoteOwnerId?: string;
  quoteText?: string;
  media?: DbMedia[];
  mentions?: DbMention[];
  source: string;
  rawMessageJson?: string;
  rawPayloadJson?: string;
};

export type DbRecentMessageRow = {
  msgId: string;
  cliMsgId: string;
  threadId: string;
  threadType: DbThreadType;
  senderId: string;
  senderName: string;
  ts: string;
  msgType: string;
  undo: {
    msgId: string;
    cliMsgId: string;
    threadId: string;
    group: boolean;
  };
  content: string;
};

export type DbMessageRow = DbRecentMessageRow & {
  timestampMs: number;
  rawThreadId?: string;
  toId?: string;
  quoteMsgId?: string;
  quoteCliMsgId?: string;
  quoteOwnerId?: string;
  quoteText?: string;
  source: string;
};

export type DbThreadRow = {
  threadId: string;
  rawThreadId: string;
  threadType: DbThreadType;
  title?: string;
  peerId?: string;
  messageCount: number;
  firstMessageAtMs?: number;
  lastMessageAtMs?: number;
  memberCount: number;
  isPinned: boolean;
  isHidden: boolean;
  isArchived: boolean;
};

export type DbStatus = {
  enabled: boolean;
  path: string;
  exists: boolean;
  messageCount: number;
  threadCount: number;
  groupCount: number;
  userCount: number;
  lastMessageAtMs?: number;
  updatedAt?: string;
};

export type DbFriendRow = {
  userId: string;
  displayName?: string;
  zaloName?: string;
  avatar?: string;
  accountStatus?: number;
  title?: string;
  chatId: string;
  messageCount: number;
  lastMessageAtMs?: number;
};

export type DbSelfProfileRow = {
  userId: string;
  displayName?: string;
  info?: Record<string, unknown>;
};

export type DbSyncThreadStatus = {
  scope: string;
  scopeThreadId: string;
  threadType: DbThreadType;
  status: string;
  cursor?: string;
  completeness?: string;
  lastSyncAt?: string;
  error?: string;
};

const DB_CONFIG_FILE = "db.json";
const DB_FILENAME = "messages.sqlite";

const connections = new Map<string, Promise<Database>>();
const writeQueues = new Map<string, Promise<void>>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function normalizeOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexSource}$`);
}

function matchesSearchPattern(value: string, query: string): boolean {
  const normalizedValue = normalizeSearchText(value);
  if (query.includes("*") || query.includes("?")) {
    return globToRegex(query).test(normalizedValue);
  }
  return normalizedValue.includes(query);
}

function safeJsonStringify(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.stringify(value);
}

function defaultDbPath(profile: string): string {
  return path.join(getProfileDir(profile), DB_FILENAME);
}

export function getDbConfigPath(profile: string): string {
  return path.join(getProfileDir(profile), DB_CONFIG_FILE);
}

export async function readDbConfig(profile: string): Promise<DbConfig> {
  const configPath = getDbConfigPath(profile);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DbConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      path: normalizeOptionalText(parsed.path),
      updatedAt: normalizeOptionalText(parsed.updatedAt) ?? nowIso(),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        enabled: false,
        updatedAt: nowIso(),
      };
    }
    throw error;
  }
}

async function writeDbConfig(profile: string, config: DbConfig): Promise<void> {
  const configPath = getDbConfigPath(profile);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function enableDb(profile: string, customPath?: string): Promise<DbConfig> {
  const config: DbConfig = {
    enabled: true,
    path: normalizeOptionalText(customPath),
    updatedAt: nowIso(),
  };
  await writeDbConfig(profile, config);
  await getDb(profile);
  return config;
}

export async function disableDb(profile: string): Promise<DbConfig> {
  const existing = await readDbConfig(profile);
  const config: DbConfig = {
    enabled: false,
    path: existing.path,
    updatedAt: nowIso(),
  };
  await writeDbConfig(profile, config);
  return config;
}

export async function isDbEnabled(profile: string): Promise<boolean> {
  const config = await readDbConfig(profile);
  return config.enabled;
}

export async function resolveDbPath(profile: string): Promise<string> {
  const config = await readDbConfig(profile);
  const configured = normalizeOptionalText(config.path);
  if (!configured) {
    return defaultDbPath(profile);
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(getProfileDir(profile), configured);
}

async function migrateDb(db: Database): Promise<void> {
  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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

    CREATE TABLE IF NOT EXISTS self_profiles (
      profile TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      info_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile)
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

    CREATE TABLE IF NOT EXISTS message_media (
      profile TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      item_index INTEGER NOT NULL,
      media_kind TEXT,
      media_url TEXT,
      media_path TEXT,
      media_type TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, message_uid, item_index)
    );

    CREATE TABLE IF NOT EXISTS message_mentions (
      profile TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      item_index INTEGER NOT NULL,
      target_user_id TEXT NOT NULL,
      pos INTEGER,
      len INTEGER,
      mention_type INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, message_uid, item_index)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      profile TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_thread_id TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      status TEXT NOT NULL,
      completeness TEXT,
      cursor TEXT,
      last_sync_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile, scope)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread_time
      ON messages (profile, scope_thread_id, timestamp_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_msg_id
      ON messages (profile, msg_id);
    CREATE INDEX IF NOT EXISTS idx_messages_cli_msg_id
      ON messages (profile, cli_msg_id);
    CREATE INDEX IF NOT EXISTS idx_threads_type
      ON threads (profile, thread_type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_members_thread
      ON thread_members (profile, scope_thread_id);
    CREATE INDEX IF NOT EXISTS idx_friends_name
      ON friends (profile, display_name, zalo_name, user_id);
  `);
}

async function openDb(profile: string): Promise<Database> {
  const filename = await resolveDbPath(profile);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const db = await open({
    filename,
    driver: sqlite3.Database,
  });
  await migrateDb(db);
  return db;
}

export async function getDb(profile: string): Promise<Database> {
  const existing = connections.get(profile);
  if (existing) {
    return existing;
  }
  const created = openDb(profile).catch((error) => {
    connections.delete(profile);
    throw error;
  });
  connections.set(profile, created);
  return created;
}

export async function closeDb(profile: string): Promise<void> {
  const existing = connections.get(profile);
  if (!existing) {
    return;
  }
  connections.delete(profile);
  const db = await existing;
  await db.close();
}

export function resolveDmPeerId(params: {
  threadId: string;
  senderId?: string;
  toId?: string;
  selfId?: string;
}): string {
  const threadId = normalizeId(params.threadId);
  const senderId = normalizeId(params.senderId);
  const toId = normalizeId(params.toId);
  const selfId = normalizeId(params.selfId);

  if (selfId) {
    if (senderId === selfId && toId && toId !== selfId) {
      return toId;
    }
    if (toId === selfId && senderId && senderId !== selfId) {
      return senderId;
    }
    if (threadId && threadId !== selfId) {
      return threadId;
    }
    if (toId && toId !== selfId) {
      return toId;
    }
    if (senderId && senderId !== selfId) {
      return senderId;
    }
  }

  if (senderId && toId && senderId === threadId && toId !== senderId) {
    return toId;
  }
  if (senderId && toId && toId === threadId && senderId !== toId) {
    return senderId;
  }
  if (threadId) {
    return threadId;
  }
  if (toId && toId !== senderId) {
    return toId;
  }
  return senderId;
}

export function resolveScopeThreadId(params: {
  threadType: DbThreadType;
  rawThreadId: string;
  senderId?: string;
  toId?: string;
  selfId?: string;
}): string {
  if (params.threadType === "group") {
    return normalizeId(params.rawThreadId);
  }
  return resolveDmPeerId({
    threadId: params.rawThreadId,
    senderId: params.senderId,
    toId: params.toId,
    selfId: params.selfId,
  });
}

function toMessageUid(record: DbMessageRecord): string {
  const scopeThreadId = normalizeId(record.scopeThreadId);
  const msgId = normalizeId(record.msgId);
  const cliMsgId = normalizeId(record.cliMsgId);
  const actionId = normalizeId(record.actionId);
  const timestamp = String(record.timestampMs || 0);

  if (msgId) {
    return `${scopeThreadId}:msg:${msgId}`;
  }
  if (cliMsgId) {
    return `${scopeThreadId}:cli:${cliMsgId}`;
  }
  if (actionId) {
    return `${scopeThreadId}:action:${actionId}`;
  }

  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        scopeThreadId,
        rawThreadId: record.rawThreadId,
        senderId: record.senderId,
        toId: record.toId,
        timestamp,
        msgType: record.msgType,
        contentText: record.contentText,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `${scopeThreadId}:hash:${hash}`;
}

async function withWriteQueue(profile: string, task: () => Promise<void>): Promise<void> {
  const prior = writeQueues.get(profile) ?? Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(task);
  writeQueues.set(profile, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(profile) === next) {
      writeQueues.delete(profile);
    }
  }
}

export function enqueueDbWrite(profile: string, task: () => Promise<void>): void {
  void withWriteQueue(profile, task).catch(() => {
    // Best effort background persistence.
  });
}

export async function persistThread(record: DbThreadRecord): Promise<void> {
  const db = await getDb(record.profile);
  const now = nowIso();
  await db.run(
    `
      INSERT INTO threads (
        profile, scope_thread_id, raw_thread_id, thread_type, peer_id, title,
        is_pinned, is_hidden, is_archived, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile, scope_thread_id) DO UPDATE SET
        raw_thread_id = excluded.raw_thread_id,
        thread_type = excluded.thread_type,
        peer_id = COALESCE(excluded.peer_id, threads.peer_id),
        title = COALESCE(excluded.title, threads.title),
        is_pinned = excluded.is_pinned,
        is_hidden = excluded.is_hidden,
        is_archived = excluded.is_archived,
        raw_json = COALESCE(excluded.raw_json, threads.raw_json),
        updated_at = excluded.updated_at
    `,
    [
      record.profile,
      record.scopeThreadId,
      record.rawThreadId,
      record.threadType,
      record.peerId ?? null,
      record.title ?? null,
      record.isPinned ? 1 : 0,
      record.isHidden ? 1 : 0,
      record.isArchived ? 1 : 0,
      record.rawJson ?? null,
      now,
      now,
    ],
  );
}

export async function replaceThreadMembers(
  profile: string,
  scopeThreadId: string,
  members: DbThreadMemberRecord[],
): Promise<void> {
  const db = await getDb(profile);
  const now = nowIso();
  await db.exec("BEGIN");
  try {
    await db.run(
      `DELETE FROM thread_members WHERE profile = ? AND scope_thread_id = ?`,
      [profile, scopeThreadId],
    );
    for (const member of members) {
      await db.run(
        `
          INSERT INTO thread_members (
            profile, scope_thread_id, user_id, display_name, zalo_name, avatar,
            account_status, member_type, raw_json, snapshot_at_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          member.profile,
          member.scopeThreadId,
          member.userId,
          member.displayName ?? null,
          member.zaloName ?? null,
          member.avatar ?? null,
          member.accountStatus ?? null,
          member.memberType ?? null,
          member.rawJson ?? null,
          member.snapshotAtMs,
          now,
          now,
        ],
      );
    }
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function persistFriend(record: DbFriendRecord): Promise<void> {
  const db = await getDb(record.profile);
  const now = nowIso();
  await db.run(
    `
      INSERT INTO friends (
        profile, user_id, display_name, zalo_name, avatar,
        account_status, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile, user_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, friends.display_name),
        zalo_name = COALESCE(excluded.zalo_name, friends.zalo_name),
        avatar = COALESCE(excluded.avatar, friends.avatar),
        account_status = COALESCE(excluded.account_status, friends.account_status),
        raw_json = COALESCE(excluded.raw_json, friends.raw_json),
        updated_at = excluded.updated_at
    `,
    [
      record.profile,
      record.userId,
      record.displayName ?? null,
      record.zaloName ?? null,
      record.avatar ?? null,
      record.accountStatus ?? null,
      record.rawJson ?? null,
      now,
      now,
    ],
  );
}

export async function persistSelfProfile(params: {
  profile: string;
  userId: string;
  displayName?: string;
  infoJson?: string;
}): Promise<void> {
  const db = await getDb(params.profile);
  const now = nowIso();
  await db.run(
    `
      INSERT INTO self_profiles (
        profile, user_id, display_name, info_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile) DO UPDATE SET
        user_id = excluded.user_id,
        display_name = COALESCE(excluded.display_name, self_profiles.display_name),
        info_json = COALESCE(excluded.info_json, self_profiles.info_json),
        updated_at = excluded.updated_at
    `,
    [
      params.profile,
      params.userId,
      params.displayName ?? null,
      params.infoJson ?? null,
      now,
      now,
    ],
  );
}

export async function persistMessage(record: DbMessageRecord): Promise<void> {
  const db = await getDb(record.profile);
  const now = nowIso();
  const messageUid = toMessageUid(record);

  await db.exec("BEGIN");
  try {
    await persistThread({
      profile: record.profile,
      scopeThreadId: record.scopeThreadId,
      rawThreadId: record.rawThreadId,
      threadType: record.threadType,
      peerId: record.peerId,
      title: record.title,
    });

    await db.run(
      `
        INSERT INTO messages (
          profile, message_uid, scope_thread_id, raw_thread_id, thread_type,
          msg_id, cli_msg_id, action_id, sender_id, sender_name, to_id,
          timestamp_ms, msg_type, content_text, content_json,
          quote_msg_id, quote_cli_msg_id, quote_owner_id, quote_text,
          source, raw_message_json, raw_payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile, message_uid) DO UPDATE SET
          scope_thread_id = excluded.scope_thread_id,
          raw_thread_id = excluded.raw_thread_id,
          thread_type = excluded.thread_type,
          msg_id = COALESCE(excluded.msg_id, messages.msg_id),
          cli_msg_id = COALESCE(excluded.cli_msg_id, messages.cli_msg_id),
          action_id = COALESCE(excluded.action_id, messages.action_id),
          sender_id = COALESCE(excluded.sender_id, messages.sender_id),
          sender_name = COALESCE(excluded.sender_name, messages.sender_name),
          to_id = COALESCE(excluded.to_id, messages.to_id),
          timestamp_ms = excluded.timestamp_ms,
          msg_type = COALESCE(excluded.msg_type, messages.msg_type),
          content_text = COALESCE(excluded.content_text, messages.content_text),
          content_json = COALESCE(excluded.content_json, messages.content_json),
          quote_msg_id = COALESCE(excluded.quote_msg_id, messages.quote_msg_id),
          quote_cli_msg_id = COALESCE(excluded.quote_cli_msg_id, messages.quote_cli_msg_id),
          quote_owner_id = COALESCE(excluded.quote_owner_id, messages.quote_owner_id),
          quote_text = COALESCE(excluded.quote_text, messages.quote_text),
          source = excluded.source,
          raw_message_json = COALESCE(excluded.raw_message_json, messages.raw_message_json),
          raw_payload_json = COALESCE(excluded.raw_payload_json, messages.raw_payload_json),
          updated_at = excluded.updated_at
      `,
      [
        record.profile,
        messageUid,
        record.scopeThreadId,
        record.rawThreadId,
        record.threadType,
        record.msgId ?? null,
        record.cliMsgId ?? null,
        record.actionId ?? null,
        record.senderId ?? null,
        record.senderName ?? null,
        record.toId ?? null,
        record.timestampMs,
        record.msgType ?? null,
        record.contentText ?? null,
        record.contentJson ?? null,
        record.quoteMsgId ?? null,
        record.quoteCliMsgId ?? null,
        record.quoteOwnerId ?? null,
        record.quoteText ?? null,
        record.source,
        record.rawMessageJson ?? null,
        record.rawPayloadJson ?? null,
        now,
        now,
      ],
    );

    await db.run(
      `DELETE FROM message_media WHERE profile = ? AND message_uid = ?`,
      [record.profile, messageUid],
    );
    await db.run(
      `DELETE FROM message_mentions WHERE profile = ? AND message_uid = ?`,
      [record.profile, messageUid],
    );

    for (const [index, media] of (record.media ?? []).entries()) {
      await db.run(
        `
          INSERT INTO message_media (
            profile, message_uid, item_index, media_kind, media_url,
            media_path, media_type, raw_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.profile,
          messageUid,
          index,
          media.mediaKind ?? null,
          media.mediaUrl ?? null,
          media.mediaPath ?? null,
          media.mediaType ?? null,
          media.rawJson ?? null,
          now,
          now,
        ],
      );
    }

    for (const [index, mention] of (record.mentions ?? []).entries()) {
      await db.run(
        `
          INSERT INTO message_mentions (
            profile, message_uid, item_index, target_user_id, pos, len,
            mention_type, raw_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.profile,
          messageUid,
          index,
          mention.uid,
          mention.pos ?? null,
          mention.len ?? null,
          mention.type ?? null,
          mention.rawJson ?? null,
          now,
          now,
        ],
      );
    }

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function setSyncState(params: {
  profile: string;
  scopeThreadId: string;
  threadType: DbThreadType;
  status: string;
  completeness?: string;
  cursor?: string;
  error?: string;
}): Promise<void> {
  const db = await getDb(params.profile);
  const now = nowIso();
  const scope = `${params.threadType}:${params.scopeThreadId}`;
  await db.run(
    `
      INSERT INTO sync_state (
        profile, scope, scope_thread_id, thread_type, status, completeness,
        cursor, last_sync_at, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile, scope) DO UPDATE SET
        status = excluded.status,
        completeness = excluded.completeness,
        cursor = COALESCE(excluded.cursor, sync_state.cursor),
        last_sync_at = excluded.last_sync_at,
        error = excluded.error,
        updated_at = excluded.updated_at
    `,
    [
      params.profile,
      scope,
      params.scopeThreadId,
      params.threadType,
      params.status,
      params.completeness ?? null,
      params.cursor ?? null,
      now,
      params.error ?? null,
      now,
      now,
    ],
  );
}

type RecentRow = {
  msg_id: string | null;
  cli_msg_id: string | null;
  scope_thread_id: string;
  thread_type: DbThreadType;
  sender_id: string | null;
  sender_name: string | null;
  timestamp_ms: number;
  msg_type: string | null;
  content_text: string | null;
  content_json: string | null;
};

export async function listRecentMessages(params: {
  profile: string;
  threadId: string;
  threadType: DbThreadType;
  count: number;
}): Promise<DbRecentMessageRow[]> {
  const db = await getDb(params.profile);
  const rows = await db.all<RecentRow[]>(
    `
      SELECT
        msg_id,
        cli_msg_id,
        scope_thread_id,
        thread_type,
        sender_id,
        sender_name,
        timestamp_ms,
        msg_type,
        content_text,
        content_json
      FROM messages
      WHERE profile = ? AND scope_thread_id = ? AND thread_type = ?
      ORDER BY timestamp_ms DESC, COALESCE(msg_id, ''), COALESCE(cli_msg_id, '')
      LIMIT ?
    `,
    [params.profile, params.threadId, params.threadType, params.count],
  );

  return rows.map((row) => ({
    msgId: row.msg_id ?? "",
    cliMsgId: row.cli_msg_id ?? "",
    threadId: row.scope_thread_id,
    threadType: row.thread_type,
    senderId: row.sender_id ?? "",
    senderName: row.sender_name ?? "",
    ts: String(row.timestamp_ms),
    msgType: row.msg_type ?? "",
    undo: {
      msgId: row.msg_id ?? "",
      cliMsgId: row.cli_msg_id ?? "",
      threadId: row.scope_thread_id,
      group: row.thread_type === "group",
    },
    content: row.content_text ?? row.content_json ?? "",
  }));
}

type MessageListRow = {
  raw_thread_id: string;
  thread_type: DbThreadType;
  msg_id: string | null;
  cli_msg_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  to_id: string | null;
  timestamp_ms: number;
  msg_type: string | null;
  content_text: string | null;
  content_json: string | null;
  quote_msg_id: string | null;
  quote_cli_msg_id: string | null;
  quote_owner_id: string | null;
  quote_text: string | null;
  source: string;
};

export async function listMessages(params: {
  profile: string;
  threadId: string;
  threadType: DbThreadType;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  newestFirst?: boolean;
}): Promise<DbMessageRow[]> {
  const db = await getDb(params.profile);
  const order = params.newestFirst ? "DESC" : "ASC";
  const limit = Number.isFinite(params.limit) ? Math.max(Math.trunc(params.limit as number), 1) : null;
  const rows = await db.all<MessageListRow[]>(
    `
      SELECT
        m.raw_thread_id,
        m.thread_type,
        m.msg_id,
        m.cli_msg_id,
        m.sender_id,
        COALESCE(
          NULLIF(m.sender_name, ''),
          NULLIF(tm.display_name, ''),
          NULLIF(tm.zalo_name, ''),
          NULLIF(f.display_name, ''),
          NULLIF(f.zalo_name, '')
        ) AS sender_name,
        m.to_id,
        m.timestamp_ms,
        m.msg_type,
        m.content_text,
        m.content_json,
        m.quote_msg_id,
        m.quote_cli_msg_id,
        m.quote_owner_id,
        m.quote_text,
        m.source
      FROM messages m
      LEFT JOIN thread_members tm
        ON tm.profile = m.profile
        AND tm.scope_thread_id = m.scope_thread_id
        AND tm.user_id = m.sender_id
      LEFT JOIN friends f
        ON f.profile = m.profile
        AND f.user_id = m.sender_id
      WHERE m.profile = ?
        AND m.scope_thread_id = ?
        AND m.thread_type = ?
        AND (? IS NULL OR timestamp_ms >= ?)
        AND (? IS NULL OR timestamp_ms < ?)
      ORDER BY m.timestamp_ms ${order}, COALESCE(m.msg_id, ''), COALESCE(m.cli_msg_id, '')
      ${limit ? "LIMIT ?" : ""}
    `,
    limit
      ? [
          params.profile,
          params.threadId,
          params.threadType,
          params.sinceMs ?? null,
          params.sinceMs ?? null,
          params.untilMs ?? null,
          params.untilMs ?? null,
          limit,
        ]
      : [
          params.profile,
          params.threadId,
          params.threadType,
          params.sinceMs ?? null,
          params.sinceMs ?? null,
          params.untilMs ?? null,
          params.untilMs ?? null,
        ],
  );

  return rows.map((row) => ({
    msgId: row.msg_id ?? "",
    cliMsgId: row.cli_msg_id ?? "",
    threadId: params.threadId,
    threadType: row.thread_type,
    senderId: row.sender_id ?? "",
    senderName: row.sender_name ?? "",
    ts: String(row.timestamp_ms),
    timestampMs: row.timestamp_ms,
    msgType: row.msg_type ?? "",
    undo: {
      msgId: row.msg_id ?? "",
      cliMsgId: row.cli_msg_id ?? "",
      threadId: params.threadId,
      group: row.thread_type === "group",
    },
    content: row.content_text ?? row.content_json ?? "",
    rawThreadId: row.raw_thread_id,
    toId: row.to_id ?? undefined,
    quoteMsgId: row.quote_msg_id ?? undefined,
    quoteCliMsgId: row.quote_cli_msg_id ?? undefined,
    quoteOwnerId: row.quote_owner_id ?? undefined,
    quoteText: row.quote_text ?? undefined,
    source: row.source,
  }));
}

type MessageByIdRow = RecentRow & {
  raw_thread_id: string;
  msg_id: string | null;
  cli_msg_id: string | null;
  action_id: string | null;
  to_id: string | null;
  quote_msg_id: string | null;
  quote_cli_msg_id: string | null;
  quote_owner_id: string | null;
  quote_text: string | null;
  source: string;
  raw_message_json: string | null;
  raw_payload_json: string | null;
};

export async function getMessageById(params: {
  profile: string;
  id: string;
}): Promise<Record<string, unknown> | null> {
  const db = await getDb(params.profile);
  const row = await db.get<MessageByIdRow>(
    `
      SELECT *
      FROM messages
      WHERE profile = ?
        AND (
          msg_id = ?
          OR cli_msg_id = ?
          OR message_uid = ?
        )
      ORDER BY timestamp_ms DESC
      LIMIT 1
    `,
    [params.profile, params.id, params.id, params.id],
  );
  if (!row) {
    return null;
  }
  return {
    threadId: row.scope_thread_id,
    rawThreadId: row.raw_thread_id,
    threadType: row.thread_type,
    msgId: row.msg_id ?? undefined,
    cliMsgId: row.cli_msg_id ?? undefined,
    actionId: row.action_id ?? undefined,
    senderId: row.sender_id ?? undefined,
    senderName: row.sender_name ?? undefined,
    toId: row.to_id ?? undefined,
    timestampMs: row.timestamp_ms,
    msgType: row.msg_type ?? undefined,
    content: row.content_text ?? undefined,
    contentJson: row.content_json ?? undefined,
    quoteMsgId: row.quote_msg_id ?? undefined,
    quoteCliMsgId: row.quote_cli_msg_id ?? undefined,
    quoteOwnerId: row.quote_owner_id ?? undefined,
    quoteText: row.quote_text ?? undefined,
    source: row.source,
    rawMessage: row.raw_message_json ? JSON.parse(row.raw_message_json) : undefined,
    rawPayload: row.raw_payload_json ? JSON.parse(row.raw_payload_json) : undefined,
  };
}

type ThreadAggRow = {
  scope_thread_id: string;
  raw_thread_id: string;
  thread_type: DbThreadType;
  title: string | null;
  peer_id: string | null;
  is_pinned: number;
  is_hidden: number;
  is_archived: number;
  message_count: number;
  first_message_at_ms: number | null;
  last_message_at_ms: number | null;
  member_count: number;
};

export async function listThreads(params: {
  profile: string;
  threadType?: DbThreadType;
}): Promise<DbThreadRow[]> {
  const db = await getDb(params.profile);
  const rows = await db.all<ThreadAggRow[]>(
    `
      SELECT
        t.scope_thread_id,
        t.raw_thread_id,
        t.thread_type,
        t.title,
        t.peer_id,
        t.is_pinned,
        t.is_hidden,
        t.is_archived,
        COUNT(m.message_uid) AS message_count,
        MIN(m.timestamp_ms) AS first_message_at_ms,
        MAX(m.timestamp_ms) AS last_message_at_ms,
        (
          SELECT COUNT(*)
          FROM thread_members tm
          WHERE tm.profile = t.profile AND tm.scope_thread_id = t.scope_thread_id
        ) AS member_count
      FROM threads t
      LEFT JOIN messages m
        ON m.profile = t.profile AND m.scope_thread_id = t.scope_thread_id
      WHERE t.profile = ?
        AND (? IS NULL OR t.thread_type = ?)
      GROUP BY
        t.scope_thread_id, t.raw_thread_id, t.thread_type, t.title, t.peer_id,
        t.is_pinned, t.is_hidden, t.is_archived
      ORDER BY COALESCE(MAX(m.timestamp_ms), 0) DESC, t.scope_thread_id
    `,
    [params.profile, params.threadType ?? null, params.threadType ?? null],
  );

  return rows.map((row) => ({
    threadId: row.scope_thread_id,
    rawThreadId: row.raw_thread_id,
    threadType: row.thread_type,
    title: row.title ?? undefined,
    peerId: row.peer_id ?? undefined,
    messageCount: row.message_count,
    firstMessageAtMs: row.first_message_at_ms ?? undefined,
    lastMessageAtMs: row.last_message_at_ms ?? undefined,
    memberCount: row.member_count,
    isPinned: row.is_pinned === 1,
    isHidden: row.is_hidden === 1,
    isArchived: row.is_archived === 1,
  }));
}

export async function listGroups(profile: string): Promise<DbThreadRow[]> {
  return listThreads({ profile, threadType: "group" });
}

type ThreadInfoRow = ThreadAggRow & {
  raw_json: string | null;
};

export async function getThreadInfo(params: {
  profile: string;
  threadId: string;
  threadType?: DbThreadType;
}): Promise<Record<string, unknown> | null> {
  const db = await getDb(params.profile);
  const row = await db.get<ThreadInfoRow>(
    `
      SELECT
        t.scope_thread_id,
        t.raw_thread_id,
        t.thread_type,
        t.title,
        t.peer_id,
        t.is_pinned,
        t.is_hidden,
        t.is_archived,
        t.raw_json,
        COUNT(m.message_uid) AS message_count,
        MIN(m.timestamp_ms) AS first_message_at_ms,
        MAX(m.timestamp_ms) AS last_message_at_ms,
        (
          SELECT COUNT(*)
          FROM thread_members tm
          WHERE tm.profile = t.profile AND tm.scope_thread_id = t.scope_thread_id
        ) AS member_count
      FROM threads t
      LEFT JOIN messages m
        ON m.profile = t.profile AND m.scope_thread_id = t.scope_thread_id
      WHERE t.profile = ?
        AND (? IS NULL OR t.thread_type = ?)
        AND (t.scope_thread_id = ? OR t.raw_thread_id = ?)
      GROUP BY
        t.scope_thread_id, t.raw_thread_id, t.thread_type, t.title, t.peer_id,
        t.is_pinned, t.is_hidden, t.is_archived, t.raw_json
      ORDER BY
        CASE WHEN t.scope_thread_id = ? THEN 0 ELSE 1 END,
        COALESCE(MAX(m.timestamp_ms), 0) DESC
      LIMIT 1
    `,
    [
      params.profile,
      params.threadType ?? null,
      params.threadType ?? null,
      params.threadId,
      params.threadId,
      params.threadId,
    ],
  );
  if (!row) {
    return null;
  }
  return {
    threadId: row.scope_thread_id,
    rawThreadId: row.raw_thread_id,
    threadType: row.thread_type,
    title: row.title ?? undefined,
    peerId: row.peer_id ?? undefined,
    messageCount: row.message_count,
    firstMessageAtMs: row.first_message_at_ms ?? undefined,
    lastMessageAtMs: row.last_message_at_ms ?? undefined,
    memberCount: row.member_count,
    isPinned: row.is_pinned === 1,
    isHidden: row.is_hidden === 1,
    isArchived: row.is_archived === 1,
    raw: row.raw_json ? JSON.parse(row.raw_json) : undefined,
  };
}

type FriendAggRow = {
  user_id: string;
  display_name: string | null;
  zalo_name: string | null;
  avatar: string | null;
  account_status: number | null;
  chat_id: string | null;
  title: string | null;
  message_count: number;
  last_message_at_ms: number | null;
};

export async function listFriends(profile: string): Promise<DbFriendRow[]> {
  const db = await getDb(profile);
  const rows = await db.all<FriendAggRow[]>(
    `
      SELECT
        f.user_id,
        f.display_name,
        f.zalo_name,
        f.avatar,
        f.account_status,
        t.scope_thread_id AS chat_id,
        t.title,
        COUNT(m.message_uid) AS message_count,
        MAX(m.timestamp_ms) AS last_message_at_ms
      FROM friends f
      LEFT JOIN threads t
        ON t.profile = f.profile
        AND t.thread_type = 'user'
        AND (t.peer_id = f.user_id OR t.scope_thread_id = f.user_id OR t.raw_thread_id = f.user_id)
      LEFT JOIN messages m
        ON m.profile = t.profile
        AND m.scope_thread_id = t.scope_thread_id
      WHERE f.profile = ?
      GROUP BY
        f.user_id, f.display_name, f.zalo_name, f.avatar, f.account_status, t.scope_thread_id, t.title
      ORDER BY COALESCE(f.display_name, f.zalo_name, f.user_id), f.user_id
    `,
    [profile],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? undefined,
    zaloName: row.zalo_name ?? undefined,
    avatar: row.avatar ?? undefined,
    accountStatus: row.account_status ?? undefined,
    title: row.title ?? undefined,
    chatId: row.chat_id ?? row.user_id,
    messageCount: row.message_count,
    lastMessageAtMs: row.last_message_at_ms ?? undefined,
  }));
}

type FriendInfoRow = FriendAggRow & {
  raw_json: string | null;
};

export async function getFriendInfo(params: {
  profile: string;
  userId: string;
}): Promise<Record<string, unknown> | null> {
  const db = await getDb(params.profile);
  const row = await db.get<FriendInfoRow>(
    `
      SELECT
        f.user_id,
        f.display_name,
        f.zalo_name,
        f.avatar,
        f.account_status,
        f.raw_json,
        t.scope_thread_id AS chat_id,
        t.title,
        COUNT(m.message_uid) AS message_count,
        MAX(m.timestamp_ms) AS last_message_at_ms
      FROM friends f
      LEFT JOIN threads t
        ON t.profile = f.profile
        AND t.thread_type = 'user'
        AND (t.peer_id = f.user_id OR t.scope_thread_id = f.user_id OR t.raw_thread_id = f.user_id)
      LEFT JOIN messages m
        ON m.profile = t.profile
        AND m.scope_thread_id = t.scope_thread_id
      WHERE f.profile = ?
        AND f.user_id = ?
      GROUP BY
        f.user_id, f.display_name, f.zalo_name, f.avatar, f.account_status,
        f.raw_json, t.scope_thread_id, t.title
      LIMIT 1
    `,
    [params.profile, params.userId],
  );
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    displayName: row.display_name ?? undefined,
    zaloName: row.zalo_name ?? undefined,
    avatar: row.avatar ?? undefined,
    accountStatus: row.account_status ?? undefined,
    title: row.title ?? undefined,
    chatId: row.chat_id ?? row.user_id,
    messageCount: row.message_count,
    lastMessageAtMs: row.last_message_at_ms ?? undefined,
    raw: row.raw_json ? JSON.parse(row.raw_json) : undefined,
  };
}

export async function findFriends(params: {
  profile: string;
  query: string;
}): Promise<DbFriendRow[]> {
  const query = normalizeSearchText(params.query);
  if (!query) {
    return [];
  }
  const rows = await listFriends(params.profile);
  return rows.filter((row) => {
    const haystacks = [
      row.userId,
      row.displayName ?? "",
      row.zaloName ?? "",
      row.title ?? "",
    ];
    return haystacks.some((value) => matchesSearchPattern(value, query));
  });
}

export async function listChats(profile: string): Promise<DbThreadRow[]> {
  return listThreads({ profile });
}

type SelfProfileDbRow = {
  user_id: string;
  display_name: string | null;
  info_json: string | null;
};

export async function getSelfProfile(profile: string): Promise<DbSelfProfileRow | null> {
  const db = await getDb(profile);
  const row = await db.get<SelfProfileDbRow>(
    `
      SELECT user_id, display_name, info_json
      FROM self_profiles
      WHERE profile = ?
      LIMIT 1
    `,
    [profile],
  );
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    displayName: row.display_name ?? undefined,
    info: row.info_json ? JSON.parse(row.info_json) as Record<string, unknown> : undefined,
  };
}

type MemberRow = {
  user_id: string;
  display_name: string | null;
  zalo_name: string | null;
  avatar: string | null;
  account_status: number | null;
  member_type: number | null;
  snapshot_at_ms: number;
};

export async function listThreadMembers(params: {
  profile: string;
  threadId: string;
}): Promise<Record<string, unknown>[]> {
  const db = await getDb(params.profile);
  const rows = await db.all<MemberRow[]>(
    `
      SELECT
        user_id, display_name, zalo_name, avatar, account_status, member_type, snapshot_at_ms
      FROM thread_members
      WHERE profile = ? AND scope_thread_id = ?
      ORDER BY COALESCE(display_name, zalo_name, user_id), user_id
    `,
    [params.profile, params.threadId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? undefined,
    zaloName: row.zalo_name ?? undefined,
    avatar: row.avatar ?? undefined,
    accountStatus: row.account_status ?? undefined,
    type: row.member_type ?? undefined,
    snapshotAtMs: row.snapshot_at_ms,
  }));
}

type StatusRow = {
  message_count: number;
  thread_count: number;
  group_count: number;
  user_count: number;
  last_message_at_ms: number | null;
  last_updated_at: string | null;
};

export async function getDbStatus(profile: string): Promise<DbStatus> {
  const filename = await resolveDbPath(profile);
  const exists = await fs
    .access(filename)
    .then(() => true)
    .catch(() => false);
  const config = await readDbConfig(profile);

  if (!exists) {
    return {
      enabled: config.enabled,
      path: filename,
      exists: false,
      messageCount: 0,
      threadCount: 0,
      groupCount: 0,
      userCount: 0,
      updatedAt: config.updatedAt,
    };
  }

  const db = await getDb(profile);
  const row = await db.get<StatusRow>(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE profile = ?) AS message_count,
      (SELECT COUNT(*) FROM threads WHERE profile = ?) AS thread_count,
      (SELECT COUNT(*) FROM threads WHERE profile = ? AND thread_type = 'group') AS group_count,
      (SELECT COUNT(*) FROM threads WHERE profile = ? AND thread_type = 'user') AS user_count,
      (SELECT MAX(timestamp_ms) FROM messages WHERE profile = ?) AS last_message_at_ms,
      (
        SELECT MAX(updated_at)
        FROM (
          SELECT updated_at FROM messages WHERE profile = ?
          UNION ALL
          SELECT updated_at FROM threads WHERE profile = ?
        )
      ) AS last_updated_at
  `, [profile, profile, profile, profile, profile, profile, profile]);

  return {
    enabled: config.enabled,
    path: filename,
    exists: true,
    messageCount: row?.message_count ?? 0,
    threadCount: row?.thread_count ?? 0,
    groupCount: row?.group_count ?? 0,
    userCount: row?.user_count ?? 0,
    lastMessageAtMs: row?.last_message_at_ms ?? undefined,
    updatedAt: row?.last_updated_at ?? config.updatedAt,
  };
}

type SyncRow = {
  scope: string;
  scope_thread_id: string;
  thread_type: DbThreadType;
  status: string;
  cursor: string | null;
  completeness: string | null;
  last_sync_at: string | null;
  error: string | null;
};

export async function listSyncState(params: {
  profile: string;
  threadType?: DbThreadType;
}): Promise<DbSyncThreadStatus[]> {
  const filename = await resolveDbPath(params.profile);
  const exists = await fs
    .access(filename)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return [];
  }

  const db = await getDb(params.profile);
  const rows = await db.all<SyncRow[]>(
    `
      SELECT scope, scope_thread_id, thread_type, status, cursor, completeness, last_sync_at, error
      FROM sync_state
      WHERE profile = ? AND (? IS NULL OR thread_type = ?)
      ORDER BY COALESCE(last_sync_at, ''), scope
    `,
    [params.profile, params.threadType ?? null, params.threadType ?? null],
  );
  return rows.map((row) => ({
    scope: row.scope,
    scopeThreadId: row.scope_thread_id,
    threadType: row.thread_type,
    status: row.status,
    cursor: row.cursor ?? undefined,
    completeness: row.completeness ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
    error: row.error ?? undefined,
  }));
}

export function normalizeInboundListenRecord(params: {
  profile: string;
  threadType: DbThreadType;
  rawThreadId: string;
  senderId?: string;
  senderName?: string;
  toId?: string;
  selfId?: string;
  title?: string;
  msgId?: string;
  cliMsgId?: string;
  actionId?: string;
  timestampMs: number;
  msgType?: string;
  contentText?: string;
  contentJson?: string;
  quoteMsgId?: string;
  quoteCliMsgId?: string;
  quoteOwnerId?: string;
  quoteText?: string;
  media?: DbMedia[];
  mentions?: DbMention[];
  rawMessage?: unknown;
  rawPayload?: unknown;
  source: string;
}): DbMessageRecord {
  const scopeThreadId = resolveScopeThreadId({
    threadType: params.threadType,
    rawThreadId: params.rawThreadId,
    senderId: params.senderId,
    toId: params.toId,
    selfId: params.selfId,
  });
  return {
    profile: params.profile,
    scopeThreadId,
    rawThreadId: params.rawThreadId,
    threadType: params.threadType,
    peerId: params.threadType === "user" ? scopeThreadId : undefined,
    title: params.title,
    msgId: normalizeOptionalText(params.msgId),
    cliMsgId: normalizeOptionalText(params.cliMsgId),
    actionId: normalizeOptionalText(params.actionId),
    senderId: normalizeOptionalText(params.senderId),
    senderName: normalizeOptionalText(params.senderName),
    toId: normalizeOptionalText(params.toId),
    timestampMs: params.timestampMs,
    msgType: normalizeOptionalText(params.msgType),
    contentText: params.contentText,
    contentJson: params.contentJson,
    quoteMsgId: normalizeOptionalText(params.quoteMsgId),
    quoteCliMsgId: normalizeOptionalText(params.quoteCliMsgId),
    quoteOwnerId: normalizeOptionalText(params.quoteOwnerId),
    quoteText: params.quoteText,
    media: params.media,
    mentions: params.mentions,
    source: params.source,
    rawMessageJson: safeJsonStringify(params.rawMessage),
    rawPayloadJson: safeJsonStringify(params.rawPayload),
  };
}

export function normalizeThreadFlags(record: Record<string, unknown>): {
  isPinned?: boolean;
  isHidden?: boolean;
  isArchived?: boolean;
} {
  return {
    isPinned: normalizeOptionalBool(record.isPinned) ?? normalizeOptionalInt(record.isPinned) === 1,
    isHidden: normalizeOptionalBool(record.isHidden) ?? normalizeOptionalInt(record.isHidden) === 1,
    isArchived:
      normalizeOptionalBool(record.isArchived) ?? normalizeOptionalInt(record.isArchived) === 1,
  };
}
