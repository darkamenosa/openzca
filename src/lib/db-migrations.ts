import fs from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

type Migration = {
  version: string;
  file: string;
};

const MIGRATIONS: Migration[] = [
  { version: "001", file: "001-initial-schema.sql" },
  { version: "002", file: "002-add-contacts.sql" },
  { version: "003", file: "003-backfill-contacts.sql" },
];

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

function nowIso(): string {
  return new Date().toISOString();
}

async function readMigrationSql(file: string): Promise<string> {
  return await fs.readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
}

function listAppliedVersions(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version?: unknown }>;
  return new Set(
    rows
      .map((row) => (typeof row.version === "string" ? row.version : ""))
      .filter(Boolean),
  );
}

export async function runMigrations(db: DatabaseSync): Promise<void> {
  db.exec(CREATE_MIGRATIONS_TABLE_SQL);
  const applied = listAppliedVersions(db);

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    const sql = await readMigrationSql(migration.file);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, nowIso());
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Best effort rollback.
      }
      throw error;
    }
  }
}
