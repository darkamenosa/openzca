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
