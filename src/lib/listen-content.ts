export type InboundMediaKind = "image" | "video" | "audio" | "file";

export type InboundContentKind =
  | "text"
  | "contact"
  | "link"
  | "location"
  | "media"
  | "file"
  | "poll"
  | "event"
  | "unknown";

export type InboundContactInfo = {
  name?: string;
  phone?: string;
};

export type InboundContentClassification = {
  contentKind: InboundContentKind;
  mediaKind: InboundMediaKind | null;
  summary: string;
  mediaUrls: string[];
  contact?: InboundContactInfo;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getStringCandidate(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

export function normalizeMessageType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function looksLikeStructuredJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first === "{" && last === "}") return true;
  if (first === "[" && last === "]") return true;
  return false;
}

export function normalizeStructuredContent(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!looksLikeStructuredJsonString(trimmed)) {
      return value;
    }
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeStructuredContent(parsed, depth + 1);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStructuredContent(entry, depth + 1));
  }

  const record = asObject(value);
  if (!record) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    normalized[key] = normalizeStructuredContent(nested, depth + 1);
  }
  return normalized;
}

export function collectHttpUrls(value: unknown, sink: Set<string>, depth = 0): void {
  if (depth > 5 || sink.size >= 16) return;

  if (typeof value === "string") {
    const escapedNormalized = value.replace(/\\\//g, "/");
    const matches = escapedNormalized.match(/https?:\/\/[^\s"'<>`]+/gi) ?? [];
    for (const match of matches) {
      const cleaned = match.replace(/[)\],.;"'`]+$/g, "").trim();
      if (isHttpUrl(cleaned)) {
        sink.add(cleaned);
      }
      if (sink.size >= 16) {
        return;
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectHttpUrls(item, sink, depth + 1);
      if (sink.size >= 16) return;
    }
    return;
  }

  const record = asObject(value);
  if (!record) return;
  for (const nested of Object.values(record)) {
    collectHttpUrls(nested, sink, depth + 1);
    if (sink.size >= 16) return;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function preferredMediaKeys(kind: InboundMediaKind): string[] {
  switch (kind) {
    case "image":
      return [
        "hdUrl",
        "normalUrl",
        "rawUrl",
        "oriUrl",
        "imageUrl",
        "photoUrl",
        "fileUrl",
        "thumbUrl",
        "thumb",
        "href",
        "url",
        "src",
      ];
    case "video":
      return [
        "videoUrl",
        "video_url",
        "mediaUrl",
        "streamUrl",
        "playUrl",
        "fileUrl",
        "rawUrl",
        "href",
        "url",
        "src",
      ];
    case "audio":
      return [
        "voiceUrl",
        "m4aUrl",
        "audioUrl",
        "voice_url",
        "m4a_url",
        "audio_url",
        "mediaUrl",
        "downloadUrl",
        "streamUrl",
        "playUrl",
        "fileUrl",
        "rawUrl",
        "href",
        "url",
        "src",
      ];
    case "file":
      return [
        "fileUrl",
        "downloadUrl",
        "rawUrl",
        "normalUrl",
        "oriUrl",
        "fileLink",
        "href",
        "url",
        "src",
      ];
  }
}

function nestedMediaKeys(kind: InboundMediaKind): string[] {
  return preferredMediaKeys(kind).filter((key) => !["href", "url", "src", "thumb"].includes(key));
}

function isMediaContainerKey(key: string): boolean {
  return [
    "attachment",
    "attachments",
    "attach",
    "attaches",
    "media",
    "medias",
    "mediaitem",
    "mediaitems",
    "medialist",
    "mediaurls",
    "image",
    "images",
    "imageitem",
    "imageitems",
    "imagelist",
    "imageurls",
    "photo",
    "photos",
    "photoitem",
    "photoitems",
    "photolist",
    "photourls",
    "video",
    "videos",
    "videourls",
    "audio",
    "audios",
    "audiourls",
    "file",
    "files",
    "fileurls",
  ].includes(key.toLowerCase().replace(/[_-]/g, ""));
}

function collectPreferredMediaUrls(
  kind: InboundMediaKind,
  content: unknown,
  allowedKeys = preferredMediaKeys(kind),
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      ordered.push(url);
    }
  };

  const record = asObject(content);
  if (record) {
    for (const key of allowedKeys) {
      if (!(key in record)) continue;
      const urls = new Set<string>();
      collectHttpUrls(record[key], urls);
      for (const url of urls) {
        push(url);
      }
    }
  }

  return ordered;
}

export function resolvePreferredMediaUrls(kind: InboundMediaKind, content: unknown): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      ordered.push(url);
    }
  };

  const preferred = collectPreferredMediaUrls(kind, content);
  if (preferred.length > 0) {
    for (const url of preferred) {
      push(url);
    }
    collectNestedMediaUrls(kind, content, push);
    return ordered;
  }

  const collected = new Set<string>();
  collectHttpUrls(content, collected);
  return [...collected];
}

function collectNestedMediaUrls(
  kind: InboundMediaKind,
  value: unknown,
  push: (url: string) => void,
  depth = 0,
  inMediaContainer = false,
): void {
  if (depth > 5) return;

  if (typeof value === "string") {
    if (!inMediaContainer) return;
    const urls = new Set<string>();
    collectHttpUrls(value, urls);
    for (const url of urls) {
      push(url);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedMediaUrls(kind, item, push, depth + 1, inMediaContainer);
    }
    return;
  }

  const record = asObject(value);
  if (!record) return;

  const nestedKeys = new Set(nestedMediaKeys(kind).map((key) => key.toLowerCase().replace(/[_-]/g, "")));
  const containerKeys = new Set(preferredMediaKeys(kind).map((key) => key.toLowerCase().replace(/[_-]/g, "")));
  for (const [key, nested] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
    if ((inMediaContainer ? containerKeys : nestedKeys).has(normalizedKey)) {
      const urls = new Set<string>();
      collectHttpUrls(nested, urls);
      for (const url of urls) {
        push(url);
      }
      continue;
    }

    if (isMediaContainerKey(normalizedKey)) {
      collectNestedMediaUrls(kind, nested, push, depth + 1, true);
      continue;
    }

    if (inMediaContainer) {
      if (Array.isArray(nested)) {
        collectNestedMediaUrls(kind, nested, push, depth + 1, true);
      }
      continue;
    }

    collectNestedMediaUrls(kind, nested, push, depth + 1, false);
  }
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asObject(record[key]);
}

function extractContactInfo(content: unknown): InboundContactInfo | null {
  const record = asObject(content);
  if (!record) return null;

  const description = getNestedRecord(record, "description");
  const contactRecord = getNestedRecord(record, "contact") ?? getNestedRecord(record, "user");
  const sources = [record, description, contactRecord].filter(
    (item): item is Record<string, unknown> => Boolean(item),
  );

  const phoneKeys = [
    "phone",
    "phoneNumber",
    "phone_number",
    "mobile",
    "mobilePhone",
    "mobile_phone",
    "tel",
    "telephone",
  ];
  const nameKeys = [
    "title",
    "name",
    "displayName",
    "display_name",
    "fullName",
    "full_name",
    "contactName",
    "contact_name",
    "zaloName",
    "zalo_name",
  ];

  let phone = "";
  let name = "";
  for (const source of sources) {
    phone ||= getStringCandidate(source, phoneKeys);
    name ||= getStringCandidate(source, nameKeys);
  }

  if (!phone && !name) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
  };
}

function isContactType(normalizedType: string): boolean {
  return (
    normalizedType.includes("recommended") ||
    normalizedType.includes("contact") ||
    normalizedType.includes("vcard") ||
    normalizedType.includes("card")
  );
}

function hasContactCardShape(contact: InboundContactInfo, content: unknown): boolean {
  if (!contact.phone) return false;
  if (contact.name) return true;

  const record = asObject(content);
  if (!record) return false;
  const description = getNestedRecord(record, "description");
  return Boolean(
    getStringCandidate(record, ["avatar", "avatarUrl", "avatar_url", "thumb", "thumbUrl"]) ||
      getStringCandidate(description ?? {}, ["qrCodeUrl", "qr_code_url", "qrUrl", "qr_url"]),
  );
}

function classifyMediaKindFromType(normalizedType: string): InboundMediaKind | null {
  if (
    normalizedType.includes("photo") ||
    normalizedType.includes("gif") ||
    normalizedType.includes("sticker") ||
    normalizedType.includes("doodle")
  ) {
    return "image";
  }
  if (normalizedType.includes("video")) return "video";
  if (normalizedType.includes("voice") || normalizedType.includes("audio")) return "audio";
  if (normalizedType.includes("share.file") || normalizedType.includes("file")) return "file";
  return null;
}

function classifyMediaKindFromContent(content: unknown): InboundMediaKind | null {
  const record = asObject(content);
  if (!record) return null;

  if (getStringCandidate(record, ["voiceUrl", "m4aUrl", "audioUrl", "voice_url", "m4a_url", "audio_url"])) {
    return "audio";
  }
  if (getStringCandidate(record, ["videoUrl", "video_url", "mediaUrl"])) return "video";
  if (
    getStringCandidate(record, [
      "hdUrl",
      "normalUrl",
      "rawUrl",
      "oriUrl",
      "imageUrl",
      "photoUrl",
    ])
  ) {
    return "image";
  }
  if (getStringCandidate(record, ["fileUrl", "downloadUrl", "fileLink", "fileName", "fileId"])) {
    return "file";
  }

  return null;
}

function summarizeContact(contact: InboundContactInfo): string {
  const lines = [`Contact card${contact.name ? `: ${contact.name}` : ""}`];
  if (contact.phone) {
    lines.push(`Phone: ${contact.phone}`);
  }
  return lines.join("\n");
}

export function summarizeStructuredContent(msgType: unknown, content: unknown): string {
  const normalizedType = normalizeMessageType(msgType);
  const record = asObject(content);

  const contact = extractContactInfo(content);
  if (contact && isContactType(normalizedType)) {
    return summarizeContact(contact);
  }

  if (normalizedType.includes("link") && record) {
    const href = getStringCandidate(record, ["href", "url", "src"]);
    if (href) return href;
  }

  if (contact && hasContactCardShape(contact, content)) {
    return summarizeContact(contact);
  }

  if (record) {
    const candidateText = getStringCandidate(record, [
      "msg",
      "message",
      "text",
      "caption",
      "title",
      "description",
      "phone",
      "phoneNumber",
      "phone_number",
      "mobile",
      "mobilePhone",
      "mobile_phone",
      "tel",
      "telephone",
      "fileName",
      "name",
      "href",
      "url",
      "src",
    ]);
    if (candidateText) return candidateText;
  }

  return normalizedType ? `<non-text:${normalizedType}>` : "<non-text-message>";
}

export function classifyInboundContent(
  msgType: unknown,
  content: unknown,
): InboundContentClassification {
  const normalizedType = normalizeMessageType(msgType);
  const contact = extractContactInfo(content);

  if (contact && isContactType(normalizedType)) {
    return {
      contentKind: "contact",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeContact(contact),
      contact,
    };
  }

  if (normalizedType.includes("link")) {
    return {
      contentKind: "link",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeStructuredContent(msgType, content),
    };
  }

  if (normalizedType.includes("location")) {
    return {
      contentKind: "location",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeStructuredContent(msgType, content),
    };
  }

  if (normalizedType.includes("poll") || normalizedType.includes("vote")) {
    return {
      contentKind: "poll",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeStructuredContent(msgType, content),
    };
  }

  if (normalizedType.includes("event")) {
    return {
      contentKind: "event",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeStructuredContent(msgType, content),
    };
  }

  if (contact && hasContactCardShape(contact, content)) {
    return {
      contentKind: "contact",
      mediaKind: null,
      mediaUrls: [],
      summary: summarizeContact(contact),
      contact,
    };
  }

  const typeMediaKind = classifyMediaKindFromType(normalizedType);
  const mediaKind = typeMediaKind ?? classifyMediaKindFromContent(content);
  if (mediaKind) {
    return {
      contentKind: mediaKind === "file" ? "file" : "media",
      mediaKind,
      mediaUrls: resolvePreferredMediaUrls(mediaKind, content),
      summary: summarizeStructuredContent(msgType, content),
    };
  }

  const record = asObject(content);
  const text = typeof content === "string" ? content.trim() : "";
  const summary = summarizeStructuredContent(msgType, content);

  return {
    contentKind: text || (record && summary && !summary.startsWith("<non-text"))
      ? "text"
      : "unknown",
    mediaKind: null,
    mediaUrls: [],
    summary,
  };
}
