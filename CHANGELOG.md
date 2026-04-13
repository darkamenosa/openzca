# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.58] - 2026-04-13

### Added

- `msg voice` can publish local audio files through `OPENZCA_VOICE_PUBLISH_CMD` before sending, which enables a URL-first voice flow for mobile-compatible playback setups

### Changed

- Local voice publish mode normalizes source audio to `.m4a` with `ffmpeg` before calling the external publish command
- `msg voice --url` now sends public audio URLs directly instead of downloading and re-uploading them first

## [0.1.55] - 2026-03-27

### Changed

- Release refinements and stability improvements

## [0.1.54] - 2026-03-27

### Changed

- Release refinements

## [0.1.52] - 2026-03-24

### Added

- `msg analyze-text` command — inspect and preview how formatted text expands before sending, including rendered length, style count, mention count, `textProperties` size, and request size estimate

## [0.1.49] - 2026-03-22

### Added

- **Local SQLite database** (`db` command group) using Node.js built-in `node:sqlite`
- `db enable` / `db disable` / `db reset` / `db status` — manage per-profile database
- `db sync` — sync groups, friends, and chats from server to local database
- `db groups` / `db group <id>` — query stored groups
- `db friends` / `db friend` — query stored friends
- `db chats` / `db chat <id>` — query stored chats
- `db messages <id>` / `db message get <id>` — query stored messages with time filters (`--since`, `--from`/`--to`)
- `db me` / `db contact` / `db info` — query stored profile data

### Fixed

- Stabilize `db status` output and chat JSON serialization

## [0.1.46] - 2026-03-12

### Added

- **Group poll commands** — `group poll create`, `group poll detail`, `group poll vote`, `group poll lock`, `group poll share`

## [0.1.44] - 2026-03-10

### Added

- **Group @mention resolution** — `@Name` or `@userId` in group messages are resolved against the group member roster; ambiguous matches fail safely
- **Text send module** with automatic payload chunking — oversized outbound messages are split into sequential messages with rebased style and mention offsets
- **Native video send** via ffmpeg/ffprobe — `.mp4` files are processed locally for thumbnail extraction and direct upload to Zalo

## [0.1.41] - 2026-03-10

### Fixed

- Anchor code block indentation in text formatting engine

## [0.1.32] - 2026-03-10

### Added

- **Markdown text formatting engine** — rich text support for outbound messages:
  - `**bold**`, `*italic*`, `~~strikethrough~~`
  - Headings (`# H1` through `### H3`), ordered/unordered lists, blockquotes
  - Inline code and fenced code blocks
  - Color tags (`{red}text{/red}`), size tags (`{big}text{/big}`), underline (`{underline}text{/underline}`)
- Comprehensive test suite for text style parsing

## [0.1.28] - 2026-02-14

### Changed

- Update all npm dependencies to latest versions

## [0.1.25] - 2026-02-14

### Added

- Refactored message history fetching with cursor-based pagination
- Group chat history via custom API hooks
- Message sorting, normalization, and page cursor helpers

### Fixed

- Default to user thread when `--group` flag is absent in `upload` command

## [0.1.15] - 2026-02-13

### Added

- `msg edit` — edit sent messages (undo + resend shim)
- `msg pin` / `msg unpin` / `msg list-pins` — message pinning
- `msg member-info` — get member/user profile info within a thread

### Removed

- `license` commands (`activate`, `deactivate`, `support-code`) — openzca is fully free and open source
- `me-id` command (consolidated into `me id`)

## [0.1.14] - 2026-02-12

### Added

- Enrich `listen --raw` payloads with quoted/reply context via `quote` and `metadata.quote`
- Append compact reply context text to `content` for downstream consumers
- Quote media extraction/download helpers: `quoteMediaPath(s)`, `quoteMediaUrl(s)`, `quoteMediaType(s)`
- `OPENZCA_LISTEN_MEDIA_FETCH_TIMEOUT_MS` environment variable
- `OPENZCA_LISTEN_INCLUDE_QUOTE_CONTEXT` and `OPENZCA_LISTEN_DOWNLOAD_QUOTE_MEDIA` toggles

## [0.1.13] - 2026-02-12

### Added

- **Supervised listener lifecycle mode** — structured events (`session_id`, `connected`, `heartbeat`, `error`, `closed`) for process managers
- Resilient recycle — periodic listener restart with automatic reconnection

## [0.1.12] - 2026-02-12

### Added

- Emit stable routing IDs in `listen --raw` payload for deterministic message routing

## [0.1.11] - 2026-02-12

### Fixed

- Normalize structured media payloads for voice and file messages in listener

## [0.1.10] - 2026-02-12

### Added

- Improved media handling pipeline with debug logging support

## [0.1.9] - 2026-02-12

### Added

- Inbound media/file support in listener for OpenClaw plugin integration
- OpenClaw ZaloUser plugin integration documentation

## [0.1.8] - 2026-02-11

### Added

- Improved QR code login visibility with auto-open guidance
- Enhanced zalouser plugin compatibility and QR login UX

## [0.1.6] - 2026-02-11

### Fixed

- Stabilize zalouser login and listener compatibility

## [0.1.5] - 2026-02-11

### Changed

- Release stabilization

## [0.1.4] - 2026-02-11

### Added

- Improved zca-cli compatibility for zalouser plugin

## [0.1.3] - 2026-02-11

### Fixed

- Read version from `package.json` instead of hardcoding

## [0.1.2] - 2026-02-11

### Changed

- Update README for published npm package

### Removed

- License commands removed from documentation

## [0.1.1] - 2026-02-11

### Changed

- Initial npm publish adjustments

## [0.1.0] - 2026-02-11

### Added

- **Initial release** — free, open-source Zalo CLI built on [zca-js](https://github.com/nicenathapong/zca-js)
- **Authentication** — QR code login (inline rendering + ASCII fallback + auto-open), credential-based login, session caching
- **Multi-account management** — add, switch, list, label, and remove profiles
- **Messaging** — send text, images, video, voice, stickers, link previews, contact cards
- **Message actions** — reactions, typing indicators, forwarding, delete, undo
- **Recent messages** — fetch recent conversation history
- **File upload** — upload files to conversations with IPC coordination
- **Group management** — create, rename, avatar, settings, member add/remove, deputy management, ownership transfer, block/unblock, invite link management, join requests, leave, disperse
- **Friend management** — list, find, online status, recommendations, add/accept/reject/cancel requests, aliases, block/unblock (including feed blocking), boards
- **Profile management** — view/update info, avatar management, online status
- **Real-time listener** — WebSocket listener with echo mode, prefix filter, webhook forwarding, raw JSON output, keep-alive with auto-reconnect
- **Global options** — `--profile`, `--debug`, `--debug-file`, `--version`
- **Environment variables** — 30+ configurable env vars for profiles, QR rendering, listener behavior, upload coordination, and debug logging
- MIT License

[0.1.55]: https://github.com/darkamenosa/openzca/compare/v0.1.54...v0.1.55
[0.1.54]: https://github.com/darkamenosa/openzca/compare/v0.1.53...v0.1.54
[0.1.52]: https://github.com/darkamenosa/openzca/compare/v0.1.51...v0.1.52
[0.1.49]: https://github.com/darkamenosa/openzca/compare/v0.1.48...v0.1.49
[0.1.46]: https://github.com/darkamenosa/openzca/compare/v0.1.45...v0.1.46
[0.1.44]: https://github.com/darkamenosa/openzca/compare/v0.1.43...v0.1.44
[0.1.41]: https://github.com/darkamenosa/openzca/compare/v0.1.40...v0.1.41
[0.1.32]: https://github.com/darkamenosa/openzca/compare/v0.1.31...v0.1.32
[0.1.28]: https://github.com/darkamenosa/openzca/compare/v0.1.27...v0.1.28
[0.1.25]: https://github.com/darkamenosa/openzca/compare/v0.1.24...v0.1.25
[0.1.15]: https://github.com/darkamenosa/openzca/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/darkamenosa/openzca/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/darkamenosa/openzca/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/darkamenosa/openzca/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/darkamenosa/openzca/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/darkamenosa/openzca/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/darkamenosa/openzca/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/darkamenosa/openzca/compare/v0.1.6...v0.1.8
[0.1.6]: https://github.com/darkamenosa/openzca/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/darkamenosa/openzca/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/darkamenosa/openzca/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/darkamenosa/openzca/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/darkamenosa/openzca/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/darkamenosa/openzca/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/darkamenosa/openzca/releases/tag/v0.1.0
