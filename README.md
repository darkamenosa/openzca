# openzca

Free and open-source CLI for Zalo, built on [zca-js](https://github.com/RFS-ADRENO/zca-js). Command structure compatible with [zca-cli.dev/docs](https://zca-cli.dev/docs).

## Integrate with OpenClaw OpenZalo plugin (including legacy `zalouser`)


## Install

```bash
npm install -g openzca@latest
```

Command aliases: `openzca`, `zca`.

Or run without installing:

```bash
npx openzca --help
```

Requires Node.js 22.13+.

The built-in DB backend now uses Node's official `node:sqlite` module, so no extra `sqlite3` native addon is installed.

## Quick start

```bash
# Login with QR code
openzca auth login

# Check your account
openzca me info

# Send a message
openzca msg send USER_ID "Hello"

# Send to a group
openzca msg send GROUP_ID "Hello team" --group

# Mention a group member by display name, username, or member id
openzca msg send GROUP_ID "Hi @Alice Nguyen" --group
openzca msg send GROUP_ID "Hi @123456789" --group

# Reply using a stored DB message id
openzca msg send USER_ID "Reply text" --reply-id MSG_ID

# Reply without DB using a listen --raw payload
openzca msg send USER_ID "Reply text" --reply-message '{"threadId":"...","msgId":"...","cliMsgId":"...","content":"...","msgType":"webchat","senderId":"...","toId":"...","ts":"..."}'

# Listen for incoming messages
openzca listen

# Enable the local SQLite DB for this profile
openzca db enable

# Backfill full group history plus recent DM/chat windows into the DB
openzca db sync

# List stored groups
openzca db group list --json

# Show stored info for one group
openzca db group info GROUP_ID --json

# Read the last 24 hours for one group
openzca db group messages GROUP_ID --since 24h --json

# Read an explicit date range
openzca db group messages GROUP_ID --from 2026-03-21T00:00:00+07:00 --to 2026-03-22T00:00:00+07:00 --json

# Read the latest 20 stored rows by default
openzca db group messages GROUP_ID --json

# Read all matching rows
openzca db group messages GROUP_ID --all --json
```

## Commands

### auth — Authentication & cache

| Command | Description |
|---------|-------------|
| `openzca auth login` | Login with QR code (`--qr-path <path>` to save QR image, `--qr-base64` for integration mode) |
| `openzca auth login-cred [file]` | Login using a credential JSON file |
| `openzca auth logout` | Remove saved credentials |
| `openzca auth status` | Show login status |
| `openzca auth cache-refresh` | Refresh friends/groups cache |
| `openzca auth cache-info` | Show cache metadata |
| `openzca auth cache-clear` | Clear local cache |

QR login renders inline in supported terminals (Ghostty, Kitty, WezTerm, iTerm2) with ASCII fallback for others.
If QR is not visible in your terminal, use `openzca auth login --open-qr` (macOS/Linux desktop) or set `OPENZCA_QR_OPEN=1`.
In non-interactive environments, `openzca` auto-opens the QR image by default (set `OPENZCA_QR_AUTO_OPEN=0` to disable).
You can also open the saved file manually (for example: `open qr.png` on macOS).

### msg — Messaging

| Command | Description |
|---------|-------------|
| `openzca msg send <threadId> <message>` | Send text with formatting (`**bold**`, `*italic*`, `~~strike~~`, etc.), group @mention resolution (`--raw` to skip formatting), and quote replies via `--reply-id` or `--reply-message` |
| `openzca msg image <threadId> [file]` | Send image(s) from file or URL |
| `openzca msg video <threadId> [file]` | Send video(s) from file or URL; single `.mp4` inputs try native video mode |
| `openzca msg voice <threadId> [file]` | Send voice message from local file or URL (`.aac`, `.mp3`, `.m4a`, `.wav`, `.ogg`) |
| `openzca msg sticker <threadId> <stickerId>` | Send a sticker |
| `openzca msg link <threadId> <url>` | Send a link |
| `openzca msg card <threadId> <contactId>` | Send a contact card |
| `openzca msg react <msgId> <cliMsgId> <threadId> <reaction>` | React to a message |
| `openzca msg typing <threadId>` | Send typing indicator |
| `openzca msg forward <message> <targets...>` | Forward text to multiple targets |
| `openzca msg delete <msgId> <cliMsgId> <uidFrom> <threadId>` | Delete a message |
| `openzca msg edit <msgId> <cliMsgId> <threadId> <message>` | Edit message (undo + resend shim) |
| `openzca msg undo <msgId> <cliMsgId> <threadId>` | Recall a sent message |
| `openzca msg upload <arg1> [arg2]` | Upload and send file(s) |
| `openzca msg recent <threadId>` | List recent messages (`-n`, `--json`, newest-first); defaults to live history, supports `--source live|db|auto`; group mode prefers direct group-history endpoint (websocket fallback) |
| `openzca msg pin <threadId>` | Pin a conversation |
| `openzca msg unpin <threadId>` | Unpin a conversation |
| `openzca msg list-pins` | List pinned conversations |
| `openzca msg member-info <userId>` | Get member/user profile info |

Media commands accept local files, `file://` paths, and repeatable `--url` options. Add `--group` for group threads.
`openzca msg video` attempts native video send for a single `.mp4` input by uploading the video and thumbnail to Zalo first. If `ffmpeg` is unavailable, the input is not a single `.mp4`, or native send fails, it falls back to the normal attachment send path. Use `--thumbnail <path-or-url>` to supply the preview image explicitly.
Local paths using `~` are expanded automatically (for positional file args, `--url`, and `OPENZCA_LISTEN_MEDIA_DIR`).
Group text sends via `openzca msg send --group` resolve unique `@Name` or `@userId` mentions against the current group member list using member ids, display names, and usernames. Mention offsets are computed after formatting markers are parsed, so messages like `**@Alice Nguyen** hello` work. If multiple members share the same label, the command fails instead of guessing.
Reply flows:

- `--reply-id <id>` resolves a stored message from the local DB by `msgId`, `cliMsgId`, or internal message uid. This requires DB persistence to be enabled for the profile.
- `--reply-message <json>` accepts either the original `message.data` object from `zca-js` or the current `openzca listen --raw` payload. Use this path when DB is disabled or when a caller already has the inbound payload in memory.
- Use exactly one of `--reply-id` or `--reply-message`.
`msg recent` keeps the previous live behavior by default. Use `--source db` to read only from the local SQLite store, or `--source auto` to try DB first and fall back to live history.

### Debug Logging

Use debug mode to write copyable logs for support/debugging:

```bash
# One-off debug run
openzca --debug msg image <threadId> ~/Desktop/screenshot.png

# Custom debug log path
openzca --debug --debug-file ~/Desktop/openzca-debug.log msg image <threadId> ~/Desktop/screenshot.png

# Or enable by environment
OPENZCA_DEBUG=1 openzca listen --raw
```

Default debug log file:

```text
~/.openzca/logs/openzca-debug.log
```

Useful command to copy recent debug logs:

```bash
tail -n 200 ~/.openzca/logs/openzca-debug.log
```

For media debugging, grep these events in the debug log:

- `listen.media.detected`
- `listen.media.cache_error`

### group — Group management

| Command | Description |
|---------|-------------|
| `openzca group list` | List groups |
| `openzca group info <groupId>` | Get group details |
| `openzca group members <groupId>` | List members |
| `openzca group create <name> <members...>` | Create a group |
| `openzca group poll create <groupId>` | Create a poll (`--question`, repeatable `--option`, optional poll flags) |
| `openzca group poll detail <pollId>` | Get poll details |
| `openzca group poll vote <pollId>` | Vote on a poll with repeatable `--option <id>` |
| `openzca group poll lock <pollId>` | Close a poll |
| `openzca group poll share <pollId>` | Share a poll |
| `openzca group rename <groupId> <name>` | Rename group |
| `openzca group avatar <groupId> <file>` | Change group avatar |
| `openzca group settings <groupId>` | Update settings (`--lock-name`, `--sign-admin`, etc.) |
| `openzca group add <groupId> <userIds...>` | Add members |
| `openzca group remove <groupId> <userIds...>` | Remove members |
| `openzca group add-deputy <groupId> <userId>` | Promote to deputy |
| `openzca group remove-deputy <groupId> <userId>` | Demote deputy |
| `openzca group transfer <groupId> <newOwnerId>` | Transfer ownership |
| `openzca group block <groupId> <userId>` | Block a member |
| `openzca group unblock <groupId> <userId>` | Unblock a member |
| `openzca group blocked <groupId>` | List blocked members |
| `openzca group enable-link <groupId>` | Enable invite link |
| `openzca group disable-link <groupId>` | Disable invite link |
| `openzca group link-detail <groupId>` | Get invite link |
| `openzca group join-link <linkId>` | Join via invite link |
| `openzca group pending <groupId>` | List pending requests |
| `openzca group review <groupId> <userId> <action>` | Approve or deny join request |
| `openzca group leave <groupId>` | Leave group |
| `openzca group disperse <groupId>` | Disperse group |

Poll creation currently targets group threads only and maps to the existing `zca-js` group poll APIs. `group poll create` requires `--question` plus at least two `--option` values, and also supports `--multi`, `--allow-add-option`, `--hide-vote-preview`, `--anonymous`, and `--expire-ms`.

### friend — Friend management

| Command | Description |
|---------|-------------|
| `openzca friend list` | List all friends |
| `openzca friend find <query>` | Find user by phone, username, or name |
| `openzca friend online` | List online friends |
| `openzca friend recommendations` | Get friend recommendations |
| `openzca friend add <userId>` | Send friend request (`-m` for message) |
| `openzca friend accept <userId>` | Accept friend request |
| `openzca friend reject <userId>` | Reject friend request |
| `openzca friend cancel <userId>` | Cancel sent friend request |
| `openzca friend sent` | List sent requests |
| `openzca friend request-status <userId>` | Check friend request status for user |
| `openzca friend remove <userId>` | Remove a friend |
| `openzca friend alias <userId> <alias>` | Set friend alias |
| `openzca friend remove-alias <userId>` | Remove alias |
| `openzca friend aliases` | List all aliases |
| `openzca friend block <userId>` | Block user |
| `openzca friend unblock <userId>` | Unblock user |
| `openzca friend block-feed <userId>` | Block user from viewing your feed |
| `openzca friend unblock-feed <userId>` | Unblock user from viewing your feed |
| `openzca friend boards <conversationId>` | Get boards in conversation |

### me — Profile

| Command | Description |
|---------|-------------|
| `openzca me info` | Get account info |
| `openzca me id` | Get your user ID |
| `openzca me update` | Update profile (`--name`, `--gender`, `--birthday`) |
| `openzca me avatar <file>` | Change avatar |
| `openzca me avatars` | List avatar history |
| `openzca me delete-avatar <id>` | Delete an avatar |
| `openzca me reuse-avatar <id>` | Reuse a previous avatar |
| `openzca me status <online\|offline>` | Set online status |
| `openzca me last-online <userId>` | Check last online time |

### db — Local SQLite source-of-truth

| Command | Description |
|---------|-------------|
| `openzca db enable` | Enable profile-scoped SQLite persistence (`--path <sqlite-file>` optional) |
| `openzca db disable` | Disable automatic DB persistence for the active profile |
| `openzca db status` | Show DB status, counts, and configured path |
| `openzca db me info` | Show the stored self profile snapshot |
| `openzca db me id` | Show the stored self user ID |
| `openzca db group list` | List groups stored in the DB |
| `openzca db group info <groupId>` | Show stored info for a group |
| `openzca db group members <groupId>` | List the stored member snapshot for a group |
| `openzca db group messages <groupId>` | List stored messages for a group (defaults to latest 20 newest-first; use `--all`, `--since <duration>`, `--from`/`--to`, `--limit`, or `--oldest-first`) |
| `openzca db friend list` | List friends stored in the DB |
| `openzca db friend find <query>` | Find stored friends by user ID or name |
| `openzca db friend info <userId>` | Show stored info for a friend |
| `openzca db friend messages <userId>` | List stored direct-message rows for a friend (defaults to latest 20 newest-first; use `--all`, `--since <duration>`, `--from`/`--to`, `--limit`, or `--oldest-first`) |
| `openzca db chat list` | List all chats stored in the DB |
| `openzca db chat info <chatId>` | Show stored info for a chat (`-g` to force group lookup) |
| `openzca db chat messages <chatId>` | List stored messages for any chat (`-g`; defaults to latest 20 newest-first; use `--all`, `--since <duration>`, `--from`/`--to`, `--limit`, or `--oldest-first`) |
| `openzca db message get <id>` | Read a single stored message by `msgId`, `cliMsgId`, or internal message uid |
| `openzca db sync` | Sync full group history, friend directory, and recent DM/chat windows into the DB |
| `openzca db sync all` | Explicit full sync |
| `openzca db sync groups` | Sync group directory, members, and full group history |
| `openzca db sync friends` | Sync friend directory only |
| `openzca db sync chats` | Sync discoverable chats and recent DM windows |
| `openzca db sync group <groupId>` | Sync one group with full group history |
| `openzca db sync chat <chatId>` | Sync one chat |

The DB is per-profile and is intended to be a factual local store for later querying. By default it lives at:

```text
~/.openzca/profiles/<profile>/messages.sqlite
```

Notes:

- DB reads are explicit. Existing live commands keep their current default behavior.
- If DB is enabled, successful send commands and `listen` write in the background on a best-effort path so normal CLI flow is not blocked by SQLite work.
- Group sync is thread-scoped and more reliable because it uses the dedicated group history API when available.
- DM/chat sync is best-effort only. `zca-js` exposes old DM messages by user-message stream, not by exact DM thread, so `db sync chats` and `db sync chat <id>` should be treated as recent-window fills, not perfect historical mirrors.
- For DMs, the DB stores messages under a stable peer-based conversation key rather than trusting the raw listener `threadId` alone.
- Time filters accept:
  - exact timestamps like `2026-03-21T10:00:00+07:00`
  - unix seconds or milliseconds
  - unix seconds or milliseconds
  - relative durations like `7m`, `24h`, `1d`, or `1d2h30m`

### listen — Real-time listener

| Command | Description |
|---------|-------------|
| `openzca listen` | Listen for incoming messages |
| `openzca listen --echo` | Auto-reply with received message |
| `openzca listen --prefix <prefix>` | Only process messages matching prefix |
| `openzca listen --webhook <url>` | POST message payload to a webhook URL |
| `openzca listen --raw` | Output raw JSON per line |
| `openzca listen --db` | Force DB writes for this listener session |
| `openzca listen --no-db` | Disable DB writes for this listener session |
| `openzca listen --keep-alive` | Auto-reconnect on disconnect |
| `openzca listen --supervised --raw` | Supervisor mode with lifecycle JSON events (`session_id`, `connected`, `heartbeat`, `error`, `closed`) |
| `openzca listen --keep-alive --recycle-ms <ms>` | Periodically recycle listener process to avoid stale sessions |

`listen --raw` includes inbound media metadata when available:

- `mediaPath`, `mediaPaths`
- `mediaUrl`, `mediaUrls`
- `mediaType`, `mediaTypes`
- `mediaKind`

It also includes stable routing fields for downstream tools:

- `threadId`, `targetId`, `conversationId`
- `senderId`, `toId`, `chatType`, `msgType`, `timestamp`
- `mentions` (normalized mention entities: `uid`, `pos`, `len`, `type`, optional `text`)
- `mentionIds` (flattened mention user IDs)
- `metadata.threadId`, `metadata.targetId`, `metadata.senderId`, `metadata.toId`
- `metadata.mentions`, `metadata.mentionIds`, `metadata.mentionCount`
- `quote` and `metadata.quote` when the inbound message is a reply to a previous message
  - Includes parsed `quote.attach` and extracted `quote.mediaUrls` when attachment URLs are present.
- `quoteMediaPath`, `quoteMediaPaths`, `quoteMediaUrl`, `quoteMediaUrls`, `quoteMediaType`, `quoteMediaTypes`
  - Present when quoted attachment URLs can be resolved/downloaded.

For direct messages, `metadata.senderName` is intentionally omitted so consumers can prefer numeric IDs for routing instead of display-name targets.

When a reply/quoted message is detected, `content` also appends a compact line:

```text
[reply context: <sender-or-owner-id>: <quoted summary>]
```

This helps downstream consumers that only read `content` (without parsing `quote`) still see reply context.

`listen` also normalizes JSON-string message payloads (common for `chat.voice` and `share.file`) so media URLs are extracted/cached instead of being forwarded as raw JSON text.

For non-text inbound messages (image/video/audio/file), `content` is emitted as a media note:

```text
[media attached: /abs/path/to/file.ext (mime/type) | https://source-url]
```

or for multiple attachments:

```text
[media attached: 2 files]
[media attached 1/2: /abs/path/one.png (image/png) | https://...]
[media attached 2/2: /abs/path/two.pdf (application/pdf) | https://...]
```

This format is compatible with OpenClaw media parsing.

### Listen Media Defaults (Zero Config)

By default, inbound media downloaded by `listen` is stored under OpenClaw state:

```text
~/.openclaw/media/openzca/<profile>/inbound
```

If `OPENCLAW_STATE_DIR` (or `CLAWDBOT_STATE_DIR`) is set, that directory is used instead of `~/.openclaw`.

Optional overrides:

- `OPENZCA_LISTEN_MEDIA_DIR`: explicit inbound media cache directory
- `OPENZCA_LISTEN_MEDIA_MAX_BYTES`: max bytes per inbound media file (default `20971520`, 20MB)
- `OPENZCA_LISTEN_MEDIA_MAX_FILES`: max inbound media files extracted per message (default `4`, max `16`)
- `OPENZCA_LISTEN_MEDIA_FETCH_TIMEOUT_MS`: max download time per inbound media URL (default `10000`)
  - Set to `0` to disable timeout.
- `OPENZCA_LISTEN_MEDIA_LEGACY_DIR=1`: use legacy storage at `~/.openzca/profiles/<profile>/inbound-media`

Listener resilience override:

- `OPENZCA_LISTEN_RECYCLE_MS`: when `listen --keep-alive` is used, force listener recycle after N milliseconds.
  - Default: `1800000` (30 minutes) if not set.
  - Set to `0` to disable auto recycle.
  - On recycle, `openzca` exits with code `75` so external supervisors (like OpenClaw Gateway) can auto-restart it.
- `OPENZCA_LISTEN_HEARTBEAT_MS`: heartbeat interval for `listen --supervised --raw` lifecycle events.
  - Default: `30000` (30 seconds).
  - Set to `0` to disable heartbeat events.
- `OPENZCA_LISTEN_INCLUDE_QUOTE_CONTEXT`: include reply context/quoted-media helper lines in `content`.
  - Default: enabled.
  - Set to `0` to disable.
- `OPENZCA_LISTEN_DOWNLOAD_QUOTE_MEDIA`: download quoted attachment URLs (if present) into inbound media cache.
  - Default: enabled.
  - Set to `0` to keep only quote metadata/URLs without downloading.
- `OPENZCA_RECENT_USER_MAX_PAGES`: max websocket history pages to scan for `msg recent` in user/DM mode.
  - Default: `20`.
  - Increase if a DM thread is old and not found in the first page.
- `OPENZCA_RECENT_GROUP_MAX_PAGES`: max websocket history pages to scan for `msg recent -g` when direct group-history path fails.
  - Default: `20`.
  - Increase if a group thread is old and not found quickly.
- `OPENZCA_LISTEN_ENFORCE_SINGLE_OWNER`: enforce one `listen` owner process per profile.
  - Default: enabled.
  - Set to `0` to allow multiple listeners on the same profile (not recommended).
- `OPENZCA_LISTEN_IPC`: expose local IPC socket from `listen` so `msg upload` can reuse the active websocket session.
  - Default: enabled.
  - Set to `0` to disable IPC.
- `OPENZCA_LISTEN_KEEPALIVE_RESTART_DELAY_MS`: when `--keep-alive` is on, restart listener after close code `1000`/`3000` with this delay.
  - Default: `2000`.
- `OPENZCA_LISTEN_KEEPALIVE_RESTART_ON_ANY_CLOSE`: force keepalive fallback restart for any close code.
  - Default: disabled.
  - Set to `1` if your environment closes with non-retry codes.

Supervised mode notes:

- Use `listen --supervised --raw` when an external process manager owns restart logic.
- In supervised mode, internal websocket retry ownership is disabled (equivalent to forcing `retryOnClose=false`).

Upload/listener coordination overrides:

- `OPENZCA_UPLOAD_IPC`: try upload via active listener IPC first.
  - Default: enabled.
  - Set to `0` to disable IPC path.
- `OPENZCA_UPLOAD_IPC_CONNECT_TIMEOUT_MS`: timeout for connecting to listener IPC socket.
  - Default: `1000`.
- `OPENZCA_UPLOAD_IPC_TIMEOUT_MS`: timeout waiting for listener IPC upload response.
  - Default: `OPENZCA_UPLOAD_TIMEOUT_MS + 5000`.
- `OPENZCA_UPLOAD_IPC_HANDLER_TIMEOUT_MS`: timeout applied by listener IPC while executing upload.
  - Default: same as `OPENZCA_UPLOAD_TIMEOUT_MS` (120000 if unset).
- `OPENZCA_UPLOAD_ENFORCE_SINGLE_OWNER`: when an active listener owner exists but IPC is unavailable, fail fast instead of starting a second listener.
  - Default: enabled.
  - Set to `0` to allow fallback listener startup (may disconnect active listener due duplicate websocket ownership).
- `OPENZCA_UPLOAD_AUTO_THREAD_TYPE`: auto-detect `msg upload` thread type (group/user) when `--group` is not provided.
  - Default: disabled (`0`) for safer routing.
  - Set to `1` to enable cache/probe-based detection.
- `OPENZCA_UPLOAD_GROUP_PROBE`: allow `msg upload` to probe `getGroupInfo` when auto thread-type detection is enabled.
  - Default: enabled.
  - Set to `0` to skip probe and rely only on cache matches.

### account — Multi-account profiles

| Command | Description |
|---------|-------------|
| `openzca account list` | List all profiles |
| `openzca account current` | Show active profile |
| `openzca account switch <name>` | Set default profile |
| `openzca account add [name]` | Create a new profile |
| `openzca account label <name> <label>` | Label a profile |
| `openzca account remove <name>` | Remove a profile |

## Multi-account profiles

Use `--profile <name>` or set `OPENZCA_PROFILE=<name>` (or legacy `ZCA_PROFILE=<name>`) to switch between accounts. Manage profiles with the `account` commands.

Profile data is stored in `~/.openzca/` (override with `OPENZCA_HOME`):

```
~/.openzca/
  profiles.json
  profiles/<name>/credentials.json
  profiles/<name>/cache/*.json
  profiles/<name>/db.json
  profiles/<name>/messages.sqlite
```

## Development

```bash
git clone https://github.com/darkamenosa/openzca.git
cd openzca
npm install
npm run build
node dist/cli.js --help
```

## License

MIT
