# Implementation Notes

## 2026-07-08 - Listener content classification for contact cards

- Issue #7 reports that inbound Zalo contact cards (`chat.recommended`) are treated as image media because their payload carries avatar and QR URLs in fields such as `thumb` and `description.qrCodeUrl`.
- Design direction: separate semantic content classification from downloadable media extraction. URL-bearing structured content is not media by default; only payloads classified as media/file produce inbound media downloads.
- Contact cards are represented as text summaries with `contentKind: "contact"` and no `mediaKind`. The summary format is language-neutral English: `Contact card: <name>` followed by `Phone: <phone>` when a phone number is available. This intentionally differs from the issue's suggested Vietnamese label so the CLI contract stays language-agnostic.
- The classifier is a reusable listener module rather than more private helpers in `src/cli.ts`, so future structured message types can be added without growing the CLI entrypoint.
- During implementation, DB `content_json` for parsed structured listener content was switched to the normalized object when one exists. That preserves parsed nested fields such as `description.phone` for JSON-string payloads.
