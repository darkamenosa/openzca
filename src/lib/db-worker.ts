import { parentPort, workerData } from "node:worker_threads";
import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from "node:sqlite";
import type {
  DbStatement,
  DbWorkerRequest,
  DbWorkerResponse,
  SerializedDbError,
} from "./db-protocol.js";

type SqliteModule = typeof import("node:sqlite");
type MigrationModule = typeof import("./db-migrations.js");

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

async function loadMigrationModule(): Promise<MigrationModule> {
  const currentUrl = new URL(import.meta.url);
  const specifier = currentUrl.pathname.endsWith("/src/lib/db-worker.ts")
    ? new URL("./db-migrations.ts", currentUrl).href
    : new URL("./db-migrations.js", currentUrl).href;
  const importDynamic = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<MigrationModule>;
  return await importDynamic(specifier);
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
  const { runMigrations } = await loadMigrationModule();
  const { filename } = workerData as WorkerData;
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  await runMigrations(db);
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
