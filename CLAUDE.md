# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

openzca is a Node.js CLI for Zalo messaging (command-compatible with zca-cli.dev/docs), built on the [zca-js](https://github.com/RFS-ADRENO/zca-js) library. It provides commands for authentication, messaging, group/friend management, profile updates, and real-time message listening. Installed globally via npm as `openzca` or `zca`.

## Commands

```bash
npm install          # install dependencies
npm run build        # build with tsup (ESM, node18 target) → dist/
npm run dev          # run directly via tsx (no build needed)
npm run typecheck    # full TypeScript check (tsc --noEmit)
npm run lint         # same as typecheck
node dist/cli.js     # run built CLI
```

There are no tests in this project.

## Architecture

This is a single-entrypoint CLI app. All source lives in `src/`:

- **`src/cli.ts`** (~3600 lines) — The entire CLI definition using Commander.js. Contains all command registration (auth, msg, group, friend, me, listen, account) and their action handlers in one file. This is the main file you'll edit for any command changes.
- **`src/lib/client.ts`** — Zalo API client wrapper: QR login, credential-based login, session creation via `zca-js`.
- **`src/lib/store.ts`** — Profile/credential/cache persistence under `~/.openzca/`. Multi-profile support with `profiles.json` and per-profile `credentials.json` + cache.
- **`src/lib/media.ts`** — Media file handling utilities: URL downloading to temp files, file validation, tilde expansion, content-type mapping.
- **`src/lib/types.ts`** — Shared TypeScript interfaces (`StoredCredentials`, `ProfilesDb`, `ProfileCachePayload`, `ProfileMeta`).

Key patterns:
- The CLI uses Commander.js with a root `program` and subcommands (e.g., `program.command("auth")` with nested `.command("login")`).
- Global options `--profile`, `--debug`, `--debug-file` are on the root command.
- The `listen` command is the most complex — handles WebSocket reconnection, media downloading, supervised mode lifecycle events, and raw JSON output enrichment.
- All Zalo API calls go through `zca-js` types (`API`, `Credentials`, `Zalo`, etc.).

## OpenClaw OpenZalo / ZaloUser Plugin Compatibility

openzca is the CLI backend for the OpenClaw OpenZalo channel plugin and its legacy `zalouser` variant. The plugin spawns `openzca` as a subprocess for all Zalo operations. Any CLI changes must remain compatible with how the plugin calls the binary.

### How the plugin calls openzca

All commands use the pattern: `zca --profile <profile> <command> [args]`

| Category | Commands used by plugin |
|----------|------------------------|
| Auth | `auth login`, `auth login --qr-base64`, `auth status`, `auth logout`, `auth cache-refresh` |
| Messaging | `msg send <id> <text> [-g]`, `msg image <id> -u <url> [-m caption] [-g]`, `msg video <id> -u <url> [-g]`, `msg voice <id> -u <url> [-g]`, `msg link <id> <url> [-g]` |
| Listening | `listen -r -k` (raw + keep-alive streaming) |
| Friends | `friend list -j`, `friend find <name> -j`, `friend online` |
| Groups | `group list -j`, `group info <id>`, `group members <id> -j` |
| Profile | `me info -j`, `me id` |

Key flags: `-j` (JSON output), `-r` (raw mode), `-k` (keep-alive), `-g` (group target), `-u` (media URL), `-m` (caption).

### Known plugin limitations (motivation for future improvements)

- **Text limit**: 2000 chars max per message
- **No thread/reply support**: `threads: false` in plugin capabilities
- **No native commands**: OpenClaw command syntax not directly supported
- **Stream blocking**: `blockStreaming: true` prevents concurrent sends during stream processing
- **Group member cache**: 5-minute TTL only; dynamic group changes lag
- **Name resolution**: Only at startup; newly added users aren't resolved until restart
- **No rate limiting**: Relies on zca-js internal limits
- **Unofficial API**: Built on reverse-engineered Zalo APIs; risk of account suspension

These limitations will be addressed in a new improved plugin. When adding features to openzca, consider whether they help lift these constraints.

## Environment Variables

Key env vars used at runtime (not for development):
- `OPENZCA_HOME` — override default `~/.openzca` data directory
- `OPENZCA_PROFILE` — select active profile without `--profile` flag
- `ZCA_PROFILE` — legacy profile env var alias (kept for backward compatibility)
- `OPENZCA_DEBUG=1` — enable debug logging
- `OPENZCA_LISTEN_*` — various listener config (media dir, timeouts, recycle intervals)
- `OPENCLAW_STATE_DIR` / `CLAWDBOT_STATE_DIR` — OpenClaw integration media storage path

## Release Process

Required order — always execute in this exact sequence:

1. Update version
2. Commit
3. Tag
4. Release on GitHub
5. Publish to npm

```bash
# 1) Update version
npm version <new_version> --no-git-tag-version

# Validate
npm run lint && npm run typecheck && npm run build

# 2) Commit
git add package.json package-lock.json README.md docs/ src/ AGENTS.md
git commit -m "release: v<new_version>"

# 3) Tag
git tag -a v<new_version> -m "openzca v<new_version>"
git push origin main
git push origin v<new_version>

# 4) GitHub release
gh release create v<new_version> \
  --repo darkamenosa/openzca \
  --title "v<new_version>" \
  --notes "Release v<new_version>"

# 5) npm publish
npm publish

# Verify
npm dist-tag ls openzca
npm view openzca@latest version
```
