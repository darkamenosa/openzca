# openzca

Free and open-source CLI for Zalo, built on [zca-js](https://github.com/nicenathapong/zca-js). Command structure compatible with [zca-cli.dev/docs](https://zca-cli.dev/docs).

## Install

```bash
npm install -g openzca
```

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

### msg — Messaging

| Command | Description |
|---------|-------------|
| `openzca msg send <threadId> <message>` | Send text message |
| `openzca msg image <threadId> [file]` | Send image(s) from file or URL |
| `openzca msg video <threadId> [file]` | Send video(s) from file or URL |
| `openzca msg voice <threadId> [file]` | Send voice message |
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

Media commands accept local files and repeatable `--url` options. Add `--group` for group threads.

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
