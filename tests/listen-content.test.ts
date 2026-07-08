import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInboundContent,
  normalizeStructuredContent,
  resolvePreferredMediaUrls,
  summarizeStructuredContent,
} from "../src/lib/listen-content.ts";

test("contact cards with JSON description summarize phone without media downloads", () => {
  const normalized = normalizeStructuredContent({
    title: "Nai HDV",
    thumb: "https://example.test/avatar.jpg",
    description: JSON.stringify({
      phone: "0378146753",
      caption: "0378146753",
      qrCodeUrl: "https://example.test/qr-code.jpg",
    }),
  });

  const result = classifyInboundContent("chat.recommended", normalized);

  assert.equal(result.contentKind, "contact");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
  assert.deepEqual(result.contact, {
    name: "Nai HDV",
    phone: "0378146753",
  });
  assert.equal(result.summary, "Contact card: Nai HDV\nPhone: 0378146753");
});

test("contact cards with normalized description summarize phone without media downloads", () => {
  const content = {
    title: "Nai HDV",
    thumb: "https://example.test/avatar.jpg",
    description: {
      phone: "0378146753",
      qrCodeUrl: "https://example.test/qr-code.jpg",
    },
  };

  assert.equal(
    summarizeStructuredContent("chat.recommended", content),
    "Contact card: Nai HDV\nPhone: 0378146753",
  );

  const result = classifyInboundContent("chat.recommended", content);
  assert.equal(result.contentKind, "contact");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
});

test("URL-bearing link previews are not classified as downloadable media", () => {
  const result = classifyInboundContent("chat.link", {
    title: "Example",
    href: "https://example.test/article",
    thumb: "https://example.test/preview.jpg",
    phone: "0378146753",
  });

  assert.equal(result.contentKind, "link");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
  assert.equal(result.summary, "https://example.test/article");
});

test("unknown structured records with only thumbnail URLs stay non-media", () => {
  const result = classifyInboundContent("chat.custom", {
    title: "Structured payload",
    thumb: "https://example.test/thumbnail.jpg",
  });

  assert.equal(result.contentKind, "text");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
  assert.equal(result.summary, "Structured payload");
});

test("phone fields alone do not force an unknown payload to become a contact card", () => {
  const result = classifyInboundContent("chat.custom", {
    phone: "0378146753",
  });

  assert.equal(result.contentKind, "text");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
  assert.equal(result.summary, "0378146753");
});

test("media messages extract preferred media URLs without sidecar URLs", () => {
  const content = {
    hdUrl: "https://example.test/photo.jpg",
    description: {
      qrCodeUrl: "https://example.test/sidecar-qr.jpg",
    },
  };

  const result = classifyInboundContent("chat.photo", content);

  assert.equal(result.contentKind, "media");
  assert.equal(result.mediaKind, "image");
  assert.deepEqual(result.mediaUrls, ["https://example.test/photo.jpg"]);
  assert.deepEqual(resolvePreferredMediaUrls("image", content), ["https://example.test/photo.jpg"]);
});

test("media messages append nested attachment URLs after top-level preferred URLs", () => {
  const content = {
    hdUrl: "https://example.test/photo-main.jpg",
    attachments: [
      { rawUrl: "https://example.test/photo-raw.jpg" },
      {
        href: "https://example.test/photo-link.jpg",
        thumb: "https://example.test/photo-thumb.jpg",
        description: {
          qrCodeUrl: "https://example.test/sidecar-qr.jpg",
        },
      },
    ],
    variants: {
      imageUrl: "https://example.test/photo-variant.jpg",
    },
    description: {
      qrCodeUrl: "https://example.test/top-level-sidecar-qr.jpg",
    },
  };

  const result = classifyInboundContent("chat.photo", content);

  assert.equal(result.contentKind, "media");
  assert.equal(result.mediaKind, "image");
  assert.deepEqual(result.mediaUrls, [
    "https://example.test/photo-main.jpg",
    "https://example.test/photo-raw.jpg",
    "https://example.test/photo-link.jpg",
    "https://example.test/photo-thumb.jpg",
    "https://example.test/photo-variant.jpg",
  ]);
});

test("media messages with nested-only attachments exclude sidecar URLs", () => {
  const result = classifyInboundContent("chat.photo", {
    attachments: [{ rawUrl: "https://example.test/real-photo.jpg" }],
    description: {
      qrCodeUrl: "https://example.test/sidecar-qr.jpg",
    },
  });

  assert.equal(result.contentKind, "media");
  assert.equal(result.mediaKind, "image");
  assert.deepEqual(result.mediaUrls, ["https://example.test/real-photo.jpg"]);
});

test("doodle messages classify as image media from type", () => {
  const result = classifyInboundContent("chat.doodle", {
    title: "Doodle",
    href: "https://example.test/doodle.png",
    thumb: "https://example.test/thumb.jpg",
  });

  assert.equal(result.contentKind, "media");
  assert.equal(result.mediaKind, "image");
  assert.deepEqual(result.mediaUrls, [
    "https://example.test/thumb.jpg",
    "https://example.test/doodle.png",
  ]);
});

test("group event payloads classify as event content", () => {
  const result = classifyInboundContent("group_event", {
    type: "update_board",
    act: "create",
  });

  assert.equal(result.contentKind, "event");
  assert.equal(result.mediaKind, null);
  assert.deepEqual(result.mediaUrls, []);
});
