# openzca Feature Reference (Based on zca-cli docs)

- Source reference: https://zca-cli.dev/docs
- Snapshot date: February 11, 2026
- CLI name in this project: `openzca` (alias `zca` is also available)

## Scope
This document captures the feature/command surface shown in `zca-cli` documentation and maps it to this open-source wrapper.

## Important Note (Free Usage)
This project is intended for free usage.

- No paid activation is required to use `openzca` features.
- You can ignore commercial/payment flows from `zca-cli` docs.
- The `license` command group in this repo is local helper storage only, not payment enforcement.

## zca-js License Requirement Check
Checked against local source: `/Users/tuyenhx/Workspace/github/zca-js`.

Findings:
- `zca-js` is MIT licensed (`package.json` + `README.md`).
- No license-activation or payment gate was found in `src/`.
- Runtime checks observed are for version update notice only (`src/update.ts`), not feature locking.

## Command Structure
```bash
openzca [--profile <name>] <command-group> <command> [arguments] [options]
```

Command groups:
- `auth`
- `msg`
- `group`
- `friend`
- `me`
- `account`
- `listen`
- `license` (optional/local helper)

## Global Options
- `-p, --profile <name>`: run command on specific profile
- `-h, --help`
- `-V, --version`

## Account Commands
- `openzca account list` (aliases: `ls`, `l`)
- `openzca account current` (alias: `whoami`)
- `openzca account switch <name>` (alias: `use`)
- `openzca account add [name]` (alias: `new`)
- `openzca account label <name> <label>`
- `openzca account remove <name>` (alias: `rm`)

## Auth Commands
- `openzca auth login [--qr-path <path>]`
- `openzca auth login-creds [file]` (also supports `login-cred`)
- `openzca auth logout`
- `openzca auth status`
- `openzca auth cache-refresh`
- `openzca auth cache-info`
- `openzca auth cache-clear`

## Messaging Commands
- `openzca msg send <threadId> <message> [--group]`
- `openzca msg image <threadId> [file] [--group] [-u|--url <url> ...] [-m|--message <text>]`
- `openzca msg video <threadId> [file] [--group] [-u|--url <url> ...] [--thumbnail <url>] [-m|--message <text>]`
- `openzca msg voice <threadId> [file] [--group] [-u|--url <url> ...]`
- `openzca msg sticker <threadId> <stickerId> [--group]`
- `openzca msg link <threadId> <url> [--group]`
- `openzca msg card <threadId> <contactId> [--group]`
- `openzca msg react <msgId> <cliMsgId> <threadId> <reaction> [--group]`
- `openzca msg typing <threadId> [--group]`
- `openzca msg forward <message> <targets...> [--group]`
- `openzca msg delete <msgId> <cliMsgId> <uidFrom> <threadId> [--group] [--only-me]`
- `openzca msg undo <msgId> <cliMsgId> <threadId> [--group]`
- `openzca msg upload [file] <threadId> [--group] [-u|--url <url> ...]`

## Group Commands
- `openzca group list [--json]`
- `openzca group info <groupId>`
- `openzca group members <groupId> [--json]`
- `openzca group create <name> <members...>`
- `openzca group rename <groupId> <name>`
- `openzca group avatar <groupId> <file>`
- `openzca group settings <groupId> [--lock-name] [--unlock-name] [--sign-admin] [--no-sign-admin]`
- `openzca group add <groupId> <userIds...>`
- `openzca group remove <groupId> <userIds...>`
- `openzca group add-deputy <groupId> <userId>`
- `openzca group remove-deputy <groupId> <userId>`
- `openzca group transfer <groupId> <newOwnerId>`
- `openzca group block <groupId> <userId>`
- `openzca group unblock <groupId> <userId>`
- `openzca group blocked <groupId>`
- `openzca group enable-link <groupId>`
- `openzca group disable-link <groupId>`
- `openzca group link-detail <groupId>`
- `openzca group join-link <linkId>`
- `openzca group pending <groupId>`
- `openzca group review <groupId> <userId> <approve|deny>`
- `openzca group leave <groupId>`
- `openzca group disperse <groupId>`

## Friend Commands
- `openzca friend list [--json]`
- `openzca friend find <query> [--json]`
- `openzca friend online [--json]`
- `openzca friend recommendations [--json]`
- `openzca friend add <userId> [-m|--message <text>]`
- `openzca friend accept <userId>`
- `openzca friend reject <userId>`
- `openzca friend cancel <userId>`
- `openzca friend sent [--json]`
- `openzca friend request-status <userId>`
- `openzca friend remove <userId>`
- `openzca friend alias <userId> <alias>`
- `openzca friend remove-alias <userId>`
- `openzca friend aliases [--json]`
- `openzca friend block <userId>`
- `openzca friend unblock <userId>`
- `openzca friend block-feed <userId>`
- `openzca friend unblock-feed <userId>`
- `openzca friend boards <conversationId> [--json]`

## Me/Profile Commands
- `openzca me info [--json]`
- `openzca me id`
- `openzca me update [--name <name>] [--gender male|female] [--birthday YYYY-MM-DD]`
- `openzca me avatar <file>`
- `openzca me avatars [--json]`
- `openzca me delete-avatar <id>`
- `openzca me reuse-avatar <id>`
- `openzca me status <online|offline>`
- `openzca me last-online <userId>`

## Listen Command
- `openzca listen [--echo] [--prefix <text>] [--webhook <url>] [--raw] [--keep-alive]`

Listener media behavior (openzca additions):
- Non-text inbound messages can be normalized into media note text in `content`.
- `--raw` payload may include:
  - `mediaPath`, `mediaPaths`
  - `mediaUrl`, `mediaUrls`
  - `mediaType`, `mediaTypes`
  - `mediaKind`
  - `mentions`, `mentionIds`
  - `metadata.mentions`, `metadata.mentionIds`, `metadata.mentionCount`
- Default inbound media cache path is under OpenClaw state dir:
  - `~/.openclaw/media/openzca/<profile>/inbound`
  - or `${OPENCLAW_STATE_DIR}/media/openzca/<profile>/inbound`

## Basic Usage Flow
```bash
# 1) Login
openzca auth login

# 2) Check session/account
openzca auth status
openzca me info

# 3) Send a message
openzca msg send USER_ID "Hello"
openzca msg send GROUP_ID "Hello team" --group

# 4) Optional listener
openzca listen --echo --keep-alive
```

## Notes for Future Maintenance
- If `zca-cli` docs change, re-snapshot and diff command/options against this file.
- Keep command aliases in sync (`account ls/l`, `account whoami`, `account use`, etc.).
- Keep profile resolution order consistent: `--profile` > `ZCA_PROFILE` > default profile.
