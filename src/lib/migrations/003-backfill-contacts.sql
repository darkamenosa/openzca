INSERT INTO contacts (
  profile,
  user_id,
  display_name,
  zalo_name,
  avatar,
  account_status,
  relationship,
  first_seen_at_ms,
  last_seen_at_ms,
  raw_json,
  created_at,
  updated_at
)
SELECT
  profile,
  user_id,
  display_name,
  zalo_name,
  avatar,
  account_status,
  'friend',
  NULL,
  NULL,
  raw_json,
  created_at,
  updated_at
FROM friends
WHERE 1 = 1
ON CONFLICT(profile, user_id) DO UPDATE SET
  display_name = COALESCE(excluded.display_name, contacts.display_name),
  zalo_name = COALESCE(excluded.zalo_name, contacts.zalo_name),
  avatar = COALESCE(excluded.avatar, contacts.avatar),
  account_status = COALESCE(excluded.account_status, contacts.account_status),
  relationship = CASE
    WHEN contacts.relationship = 'friend' OR excluded.relationship = 'friend' THEN 'friend'
    WHEN contacts.relationship = 'seen_dm' OR excluded.relationship = 'seen_dm' THEN 'seen_dm'
    WHEN contacts.relationship = 'seen_group' OR excluded.relationship = 'seen_group' THEN 'seen_group'
    ELSE COALESCE(excluded.relationship, contacts.relationship, 'unknown')
  END,
  raw_json = COALESCE(excluded.raw_json, contacts.raw_json),
  updated_at = excluded.updated_at;

INSERT INTO contacts (
  profile,
  user_id,
  display_name,
  zalo_name,
  avatar,
  account_status,
  relationship,
  first_seen_at_ms,
  last_seen_at_ms,
  raw_json,
  created_at,
  updated_at
)
SELECT
  profile,
  user_id,
  NULLIF(MAX(display_name), ''),
  NULLIF(MAX(zalo_name), ''),
  NULLIF(MAX(avatar), ''),
  MAX(account_status),
  'seen_group',
  MIN(snapshot_at_ms),
  MAX(snapshot_at_ms),
  NULLIF(MAX(raw_json), ''),
  MIN(created_at),
  MAX(updated_at)
FROM thread_members
WHERE 1 = 1
GROUP BY profile, user_id
ON CONFLICT(profile, user_id) DO UPDATE SET
  display_name = COALESCE(excluded.display_name, contacts.display_name),
  zalo_name = COALESCE(excluded.zalo_name, contacts.zalo_name),
  avatar = COALESCE(excluded.avatar, contacts.avatar),
  account_status = COALESCE(excluded.account_status, contacts.account_status),
  relationship = CASE
    WHEN contacts.relationship = 'friend' OR excluded.relationship = 'friend' THEN 'friend'
    WHEN contacts.relationship = 'seen_dm' OR excluded.relationship = 'seen_dm' THEN 'seen_dm'
    WHEN contacts.relationship = 'seen_group' OR excluded.relationship = 'seen_group' THEN 'seen_group'
    ELSE COALESCE(excluded.relationship, contacts.relationship, 'unknown')
  END,
  first_seen_at_ms = CASE
    WHEN contacts.first_seen_at_ms IS NULL THEN excluded.first_seen_at_ms
    WHEN excluded.first_seen_at_ms IS NULL THEN contacts.first_seen_at_ms
    ELSE MIN(contacts.first_seen_at_ms, excluded.first_seen_at_ms)
  END,
  last_seen_at_ms = CASE
    WHEN contacts.last_seen_at_ms IS NULL THEN excluded.last_seen_at_ms
    WHEN excluded.last_seen_at_ms IS NULL THEN contacts.last_seen_at_ms
    ELSE MAX(contacts.last_seen_at_ms, excluded.last_seen_at_ms)
  END,
  raw_json = COALESCE(excluded.raw_json, contacts.raw_json),
  updated_at = excluded.updated_at;

INSERT INTO contacts (
  profile,
  user_id,
  display_name,
  zalo_name,
  avatar,
  account_status,
  relationship,
  first_seen_at_ms,
  last_seen_at_ms,
  raw_json,
  created_at,
  updated_at
)
SELECT
  t.profile,
  COALESCE(NULLIF(t.peer_id, ''), t.scope_thread_id) AS user_id,
  COALESCE(
    NULLIF(MAX(CASE
      WHEN m.sender_id = COALESCE(NULLIF(t.peer_id, ''), t.scope_thread_id) THEN m.sender_name
      ELSE NULL
    END), ''),
    NULLIF(MAX(t.title), '')
  ) AS display_name,
  NULL,
  NULL,
  NULL,
  'seen_dm',
  MIN(m.timestamp_ms),
  MAX(m.timestamp_ms),
  t.raw_json,
  MIN(t.created_at),
  MAX(COALESCE(m.updated_at, t.updated_at))
FROM threads t
LEFT JOIN messages m
  ON m.profile = t.profile
  AND m.scope_thread_id = t.scope_thread_id
  AND m.thread_type = 'user'
WHERE t.thread_type = 'user'
  AND COALESCE(NULLIF(t.peer_id, ''), t.scope_thread_id) <> ''
GROUP BY t.profile, COALESCE(NULLIF(t.peer_id, ''), t.scope_thread_id), t.raw_json
ON CONFLICT(profile, user_id) DO UPDATE SET
  display_name = COALESCE(excluded.display_name, contacts.display_name),
  relationship = CASE
    WHEN contacts.relationship = 'friend' OR excluded.relationship = 'friend' THEN 'friend'
    WHEN contacts.relationship = 'seen_dm' OR excluded.relationship = 'seen_dm' THEN 'seen_dm'
    WHEN contacts.relationship = 'seen_group' OR excluded.relationship = 'seen_group' THEN 'seen_group'
    ELSE COALESCE(excluded.relationship, contacts.relationship, 'unknown')
  END,
  first_seen_at_ms = CASE
    WHEN contacts.first_seen_at_ms IS NULL THEN excluded.first_seen_at_ms
    WHEN excluded.first_seen_at_ms IS NULL THEN contacts.first_seen_at_ms
    ELSE MIN(contacts.first_seen_at_ms, excluded.first_seen_at_ms)
  END,
  last_seen_at_ms = CASE
    WHEN contacts.last_seen_at_ms IS NULL THEN excluded.last_seen_at_ms
    WHEN excluded.last_seen_at_ms IS NULL THEN contacts.last_seen_at_ms
    ELSE MAX(contacts.last_seen_at_ms, excluded.last_seen_at_ms)
  END,
  raw_json = COALESCE(excluded.raw_json, contacts.raw_json),
  updated_at = excluded.updated_at;
