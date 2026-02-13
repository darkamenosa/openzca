# openzca

Free and open-source CLI for Zalo, built on [zca-js](https://github.com/nicenathapong/zca-js). Command structure compatible with [zca-cli.dev/docs](https://zca-cli.dev/docs).

## Integrate with OpenClaw ZaloUser plugin

Prompt:
```
help me to enable zalouser openclaw plugin. However, don't install zca cli follow their instruction, please use: npm install -g openzca@latest
```


## Install

```bash
npm install -g openzca@latest
```

Command aliases: `openzca`, `zca`.

Or run without installing:

```bash
npx openzca --help
```

Requires Node.js 18+.

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

# Listen for incoming messages
openzca listen
```

## Commands

### auth — Authentication & cache

| Command | Description |
|---------|-------------|
| `openzca auth login` | Login with QR code (`--qr-path <path>` to save QR image) |
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
| `openzca msg send <threadId> <message>` | Send text message |
| `openzca msg image <threadId> [file]` | Send image(s) from file or URL |
| `openzca msg video <threadId> [file]` | Send video(s) from file or URL |
| `openzca msg voice <threadId> [file]` | Send voice message from local file or URL (`.aac`, `.mp3`, `.m4a`, `.wav`, `.ogg`) |
| `openzca msg sticker <threadId> <stickerId>` | Send a sticker |
| `openzca msg link <threadId> <url>` | Send a link |
| `openzca msg card <threadId> <contactId>` | Send a contact card |
| `openzca msg react <msgId> <cliMsgId> <threadId> <reaction>` | React to a message |
| `openzca msg typing <threadId>` | Send typing indicator |
| `openzca msg forward <message> <targets...>` | Forward text to multiple targets |
| `openzca msg delete <msgId> <cliMsgId> <uidFrom> <threadId>` | Delete a message |
| `openzca msg undo <msgId> <cliMsgId> <threadId>` | Recall a sent message |
| `openzca msg upload <arg1> [arg2]` | Upload and send file(s) |
| `openzca msg recent <threadId>` | List recent messages (`-n`, `--json`) |

Media commands accept local files, `file://` paths, and repeatable `--url` options. Add `--group` for group threads.
Local paths using `~` are expanded automatically (for positional file args, `--url`, and `OPENZCA_LISTEN_MEDIA_DIR`).

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
| `openzca friend remove <userId>` | Remove a friend |
| `openzca friend alias <userId> <alias>` | Set friend alias |
| `openzca friend remove-alias <userId>` | Remove alias |
| `openzca friend aliases` | List all aliases |
| `openzca friend block <userId>` | Block user |
| `openzca friend unblock <userId>` | Unblock user |
| `openzca friend block-feed <userId>` | Block user from viewing your feed |
| `openzca friend unblock-feed <userId>` | Unblock user from viewing your feed |

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

### listen — Real-time listener

| Command | Description |
|---------|-------------|
| `openzca listen` | Listen for incoming messages |
| `openzca listen --echo` | Auto-reply with received message |
| `openzca listen --prefix <prefix>` | Only process messages matching prefix |
| `openzca listen --webhook <url>` | POST message payload to a webhook URL |
| `openzca listen --raw` | Output raw JSON per line |
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

Supervised mode notes:

- Use `listen --supervised --raw` when an external process manager owns restart logic.
- In supervised mode, internal websocket retry ownership is disabled (equivalent to forcing `retryOnClose=false`).

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

Use `--profile <name>` or set `ZCA_PROFILE=<name>` to switch between accounts. Manage profiles with the `account` commands.

Profile data is stored in `~/.openzca/` (override with `OPENZCA_HOME`):

```
~/.openzca/
  profiles.json
  profiles/<name>/credentials.json
  profiles/<name>/cache/*.json
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
