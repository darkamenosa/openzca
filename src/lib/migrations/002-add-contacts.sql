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

CREATE INDEX IF NOT EXISTS idx_contacts_name
  ON contacts (profile, display_name, zalo_name, user_id);
