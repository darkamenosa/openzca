import { parentPort, workerData } from "node:worker_threads";
import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from "node:sqlite";
import type {
  DbStatement,
  DbWorkerRequest,
  DbWorkerResponse,
  SerializedDbError,
} from "./db-protocol.js";

const INIT_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
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
`;

type SqliteModule = typeof import("node:sqlite");

type WorkerData = {
  filename: string;
};

if (!parentPort) {
  throw new Error("DB worker requires parentPort");
}

const port = parentPort;

function serializeError(error: unknown): SerializedDbError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code:
        typeof (error as Error & { code?: unknown }).code === "string"
          ? (error as Error & { code?: string }).code
          : undefined,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

async function loadSqliteModule(): Promise<SqliteModule> {
  const originalEmitWarning = process.emitWarning;
  const importDynamic = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<SqliteModule>;
  process.emitWarning = ((warning: string | Error, options?: string | Error | object, ...args: unknown[]) => {
    const type = typeof options === "string" ? options : undefined;
    const message = warning instanceof Error ? warning.message : String(warning);
    if (type === "ExperimentalWarning" && message.includes("SQLite")) {
      return;
    }
    Reflect.apply(originalEmitWarning, process, [warning, options as never, ...args]);
  }) as typeof process.emitWarning;
  try {
    return await importDynamic("node:sqlite");
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function setDefensiveMode(db: DatabaseSync): void {
  const maybeDb = db as DatabaseSync & {
    enableDefensive?: (active: boolean) => void;
  };
  if (typeof maybeDb.enableDefensive === "function") {
    maybeDb.enableDefensive(true);
  }
}

function runStatement(
  db: DatabaseSync,
  statement: DbStatement,
): StatementResultingChanges {
  return db.prepare(statement.sql).run(...((statement.params ?? []) as SQLInputValue[]));
}

function getStatement(db: DatabaseSync, statement: DbStatement): Record<string, unknown> | undefined {
  return db.prepare(statement.sql).get(...((statement.params ?? []) as SQLInputValue[])) as
    | Record<string, unknown>
    | undefined;
}

function allStatement(db: DatabaseSync, statement: DbStatement): Record<string, unknown>[] {
  return db.prepare(statement.sql).all(...((statement.params ?? []) as SQLInputValue[])) as Record<
    string,
    unknown
  >[];
}

async function main(): Promise<void> {
  const { DatabaseSync } = await loadSqliteModule();
  const { filename } = workerData as WorkerData;
  const db = new DatabaseSync(filename);
  db.exec(INIT_SQL);
  setDefensiveMode(db);

  port.postMessage({ type: "ready" } satisfies DbWorkerResponse);

  port.on("message", (message: DbWorkerRequest) => {
    try {
      switch (message.type) {
        case "exec":
          db.exec(message.payload.sql);
          port.postMessage({
            type: "result",
            id: message.id,
            result: null,
          } satisfies DbWorkerResponse);
          return;
        case "run":
          port.postMessage({
            type: "result",
            id: message.id,
            result: runStatement(db, message.payload),
          } satisfies DbWorkerResponse);
          return;
        case "get":
          port.postMessage({
            type: "result",
            id: message.id,
            result: getStatement(db, message.payload) ?? null,
          } satisfies DbWorkerResponse);
          return;
        case "all":
          port.postMessage({
            type: "result",
            id: message.id,
            result: allStatement(db, message.payload),
          } satisfies DbWorkerResponse);
          return;
        case "batch":
          if (message.payload.transactional) {
            db.exec("BEGIN");
          }
          try {
            for (const command of message.payload.commands) {
              if ((command.params ?? []).length === 0) {
                db.exec(command.sql);
              } else {
                runStatement(db, command);
              }
            }
            if (message.payload.transactional) {
              db.exec("COMMIT");
            }
          } catch (error) {
            if (message.payload.transactional) {
              try {
                db.exec("ROLLBACK");
              } catch {
                // Preserve the original error.
              }
            }
            throw error;
          }
          port.postMessage({
            type: "result",
            id: message.id,
            result: null,
          } satisfies DbWorkerResponse);
          return;
        case "close":
          db.close();
          port.postMessage({
            type: "result",
            id: message.id,
            result: null,
          } satisfies DbWorkerResponse);
          setImmediate(() => process.exit(0));
          return;
      }
    } catch (error) {
      port.postMessage({
        type: "error",
        id: message.id,
        error: serializeError(error),
      } satisfies DbWorkerResponse);
    }
  });
}

void main().catch((error) => {
  port.postMessage({
    type: "fatal",
    error: serializeError(error),
  } satisfies DbWorkerResponse);
  process.exit(1);
});
