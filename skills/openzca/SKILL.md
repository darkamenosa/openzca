---
name: openzca
description: Use the openzca CLI to send Zalo messages, manage groups/friends, check auth status, or listen for incoming messages. Trigger when the user asks to send a message via Zalo, interact with Zalo contacts or groups, or manage a Zalo session using the openzca CLI tool.
allowed-tools: Bash(openzca *) Bash(zca*)
---

# openzca — Zalo CLI Agent Skill

openzca is a Node.js CLI for Zalo messaging. Use `openzca` (or the alias `zca`) as the executable.

## Command Structure

```
openzca [--profile <name>] <command-group> <subcommand> [args] [options]
```

### Global Options
| Option | Description |
|--------|-------------|
| `-p, --profile <name>` | Use a specific account profile |
| `--debug` | Enable debug logging |
| `--debug-file <path>` | Write debug logs to a file |

---

## Auth

```bash
openzca auth login                        # Interactive QR login
openzca auth login --qr-base64            # QR as base64 (for plugin)
openzca auth login-creds [file]           # Login with credentials file
openzca auth status                       # Check session status
openzca auth logout                       # Log out
openzca auth cache-refresh                # Refresh contact/group cache
openzca auth cache-info                   # Show cache metadata
openzca auth cache-clear                  # Clear cache
```

---

## Messaging (`msg`)

```bash
# Text
openzca msg send <threadId> "<text>"
openzca msg send <threadId> "<text>" --group          # Send to group
openzca msg send <threadId> "Hi @Alice Nguyen" --group  # @mention by name
openzca msg send <threadId> "Hi @123456789" --group    # @mention by userId

# Media
openzca msg image <threadId> -u <url> [-m "<caption>"]
openzca msg image <threadId> -u <url> --group
openzca msg video <threadId> -u <url> [--thumbnail <path-or-url>]
openzca msg voice <threadId> -u <url>
openzca msg upload <threadId> -u <url>               # Generic file upload

# Link / Sticker / Contact card
openzca msg link <threadId> <url>
openzca msg sticker <threadId> <stickerId>
openzca msg card <threadId> <contactId>

# Reactions & editing
openzca msg react <msgId> <cliMsgId> <threadId> <reaction>
openzca msg edit  <msgId> <cliMsgId> <threadId> "<new text>"
openzca msg undo  <msgId> <cliMsgId> <threadId>
openzca msg delete <msgId> <cliMsgId> <uidFrom> <threadId> [--only-me]

# Forwarding & typing
openzca msg forward "<message>" <target1> [<target2>...]
openzca msg typing <threadId>

# Recent messages & pins
openzca msg recent <threadId> [-n <count>] [--json]
openzca msg pin <threadId>
openzca msg unpin <threadId>
openzca msg list-pins [--json]

# Member info
openzca msg member-info <userId> [--json]
```

**Notes:**
- `--group` / `-g` targets a group thread instead of a direct message.
- `msg video` uses native Zalo video mode for `.mp4` when `ffmpeg` is available; falls back to attachment upload otherwise.
- `msg voice` normalizes local files to `.m4a` via `ffmpeg` + `OPENZCA_VOICE_PUBLISH_CMD` when configured.

---

## Groups (`group`)

```bash
openzca group list [--json]
openzca group info <groupId>
openzca group members <groupId> [--json]
openzca group create <name> <userId1> [<userId2>...]

# Polls
openzca group poll create <groupId> \
  --question "<text>" \
  --option "<opt1>" --option "<opt2>" \
  [--multi] [--allow-add-option] [--anonymous] [--expire-ms <ms>] [--json]
openzca group poll detail <pollId> [--json]
openzca group poll vote <pollId> --option <id> [--json]
openzca group poll lock <pollId> [--json]
openzca group poll share <pollId> [--json]

# Management
openzca group rename <groupId> <name>
openzca group avatar <groupId> <file>
openzca group settings <groupId> [--lock-name | --unlock-name] [--sign-admin | --no-sign-admin]
openzca group add    <groupId> <userId...>
openzca group remove <groupId> <userId...>
openzca group add-deputy    <groupId> <userId>
openzca group remove-deputy <groupId> <userId>
openzca group transfer <groupId> <newOwnerId>

# Block / join
openzca group block   <groupId> <userId>
openzca group unblock <groupId> <userId>
openzca group blocked <groupId>
openzca group enable-link  <groupId>
openzca group disable-link <groupId>
openzca group link-detail  <groupId>
openzca group join-link    <linkId>

# Pending members
openzca group pending <groupId>
openzca group review  <groupId> <userId> <approve|deny>

# Leave / disband
openzca group leave    <groupId>
openzca group disperse <groupId>
```

---

## Friends (`friend`)

```bash
openzca friend list [--json]
openzca friend find <query> [--json]
openzca friend online [--json]
openzca friend recommendations [--json]

openzca friend add    <userId> [-m "<message>"]
openzca friend accept <userId>
openzca friend reject <userId>
openzca friend cancel <userId>
openzca friend sent   [--json]
openzca friend request-status <userId>
openzca friend remove <userId>

openzca friend alias        <userId> <alias>
openzca friend remove-alias <userId>
openzca friend aliases      [--json]

openzca friend block        <userId>
openzca friend unblock      <userId>
openzca friend block-feed   <userId>
openzca friend unblock-feed <userId>
openzca friend boards       <conversationId> [--json]
```

---

## Profile (`me`)

```bash
openzca me info [--json]
openzca me id
openzca me update [--name <name>] [--gender male|female] [--birthday YYYY-MM-DD]
openzca me avatar <file>
openzca me avatars [--json]
openzca me delete-avatar <id>
openzca me reuse-avatar <id>
openzca me status <online|offline>
openzca me last-online <userId>
```

---

## Accounts (`account`)

```bash
openzca account list                     # List profiles (alias: ls, l)
openzca account current                  # Show active profile (alias: whoami)
openzca account switch <name>            # Switch profile (alias: use)
openzca account add [name]               # Add new profile (alias: new)
openzca account label <name> <label>
openzca account remove <name>            # Remove profile (alias: rm)
```

---

## Listen (`listen`)

```bash
openzca listen \
  [--echo] \
  [--prefix <text>] \
  [--webhook <url>] \
  [--raw] \
  [--self] \
  [--keep-alive] \
  [--supervised] \
  [--heartbeat-ms <ms>] \
  [--recycle-ms <ms>]
```

Raw (`--raw`) payload may include: `mediaPath`, `mediaUrl`, `mediaType`, `mediaKind`, `mentions`, `mentionIds`, `pollId`, `pollTitle`, `poll`, `rawMessage`, `rawGroupEvent`.

---

## Typical Workflow

```bash
# 1. Login
openzca auth login

# 2. Verify session
openzca auth status
openzca me info

# 3. Send a message
openzca msg send <userId> "Hello"
openzca msg send <groupId> "Hello team" --group

# 4. Stream incoming messages
openzca listen --echo --keep-alive
```

---

## Multi-profile Usage

```bash
openzca --profile work  msg send <id> "Hi from work account"
openzca --profile home  auth status
```

Profile resolution order: `--profile` > `OPENZCA_PROFILE` > `ZCA_PROFILE` (legacy) > default profile.

---

## Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENZCA_HOME` | Override `~/.openzca` data directory |
| `OPENZCA_PROFILE` | Select active profile |
| `ZCA_PROFILE` | Legacy profile alias |
| `OPENZCA_DEBUG=1` | Enable debug logging |
| `OPENZCA_VOICE_PUBLISH_CMD` | Command to publish voice files to a public URL |
| `OPENCLAW_STATE_DIR` | OpenClaw media storage path |
