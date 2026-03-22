import { ThreadType, type SendMessageQuote } from "zca-js";

type ReplyMessageRecord = Record<string, unknown>;

type ReplyMessageContent = string | Record<string, unknown>;

export type PreparedReplyMessage = {
  quote: SendMessageQuote;
  inferredThreadId?: string;
};

export function prepareReplyMessage(
  value: unknown,
  params?: {
    threadType?: ThreadType;
    selfId?: string;
  },
): PreparedReplyMessage {
  const sourceRecord = asReplyMessageRecord(value);
  const metadata = asOptionalReplyMessageRecord(sourceRecord.metadata);
  const rawMessageRecord = asOptionalReplyMessageRecord(sourceRecord.rawMessage);
  const rawPayloadRecord = asOptionalReplyMessageRecord(sourceRecord.rawPayload);
  const canonicalRecord = rawMessageRecord ?? sourceRecord;

  const content = parseReplyMessageContent(
    canonicalRecord.content ?? sourceRecord.content,
    isLikelyOpenzcaListenPayload(sourceRecord) && !rawMessageRecord,
  );
  const msgType = requireStringLike(
    [canonicalRecord.msgType, sourceRecord.msgType, metadata?.msgType],
    "reply message msgType",
  );
  const uidFrom = requireStringLike(
    [
      canonicalRecord.uidFrom,
      sourceRecord.uidFrom,
      sourceRecord.senderId,
      sourceRecord.fromId,
      metadata?.senderId,
      metadata?.fromId,
    ],
    "reply message uidFrom",
  );
  const msgId = requireStringLike(
    [canonicalRecord.msgId, sourceRecord.msgId, rawPayloadRecord?.msgId],
    "reply message msgId",
  );
  const cliMsgId = requireStringLike(
    [canonicalRecord.cliMsgId, sourceRecord.cliMsgId, rawPayloadRecord?.cliMsgId],
    "reply message cliMsgId",
  );
  const ts = requireTsString(
    [canonicalRecord.ts, sourceRecord.ts, maybeTimestampSecondsToMsString(sourceRecord.timestamp)],
    "reply message ts",
  );
  const ttl = parseReplyMessageTtl(canonicalRecord.ttl ?? sourceRecord.ttl);
  const propertyExt = parseReplyMessagePropertyExt(canonicalRecord.propertyExt);

  return {
    quote: {
      content,
      msgType,
      propertyExt,
      uidFrom,
      msgId,
      cliMsgId,
      ts,
      ttl,
    },
    inferredThreadId: inferReplyMessageThreadId({
      sourceRecord,
      canonicalRecord,
      metadata,
      threadType: params?.threadType,
      selfId: params?.selfId,
    }),
  };
}

export function prepareStoredReplyMessage(
  value: unknown,
  params: {
    threadId: string;
    threadType: ThreadType;
    selfId?: string;
  },
): SendMessageQuote {
  const record = asReplyMessageRecord(value);
  const storedThreadType =
    record.threadType === "group"
      ? ThreadType.Group
      : record.threadType === "user"
        ? ThreadType.User
        : undefined;
  if (storedThreadType !== undefined && storedThreadType !== params.threadType) {
    throw new Error("Reply source thread type does not match --group.");
  }

  const storedThreadId =
    firstString([record.threadId, record.rawThreadId]) ?? undefined;
  if (storedThreadId && storedThreadId !== params.threadId) {
    throw new Error("Reply source belongs to a different thread.");
  }

  const rawMessage = asOptionalReplyMessageRecord(record.rawMessage);
  const rawPayload = asOptionalReplyMessageRecord(record.rawPayload);
  const replyRecord = rawMessage ?? rawPayload;
  if (!replyRecord) {
    throw new Error(
      "Reply source found in DB but has no reusable raw message payload. Re-sync or capture it via listener first.",
    );
  }

  return prepareReplyMessage(replyRecord, {
    threadType: params.threadType,
    selfId: params.selfId,
  }).quote;
}

function asReplyMessageRecord(value: unknown): ReplyMessageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reply message must be a JSON object matching the raw message.data shape.");
  }
  return value as ReplyMessageRecord;
}

function asOptionalReplyMessageRecord(value: unknown): ReplyMessageRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as ReplyMessageRecord;
}

function parseReplyMessageContent(
  value: unknown,
  stripOpenzcaDecorations: boolean,
): ReplyMessageContent {
  if (typeof value === "string") {
    return stripOpenzcaDecorations ? stripEnrichedReplyDecorations(value) : value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Reply message content must be a string or object.");
}

function stripEnrichedReplyDecorations(value: string): string {
  const lines = value.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (
      last.startsWith("[reply context: ") ||
      last.startsWith("[reply media attached:")
      || last.startsWith("[reply media attached ")
    ) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n");
}

function parseReplyMessagePropertyExt(
  value: unknown,
): SendMessageQuote["propertyExt"] {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reply message propertyExt must be an object when provided.");
  }
  return value as SendMessageQuote["propertyExt"];
}

function parseReplyMessageTtl(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error("Reply message ttl must be a finite number.");
  }
  return Math.trunc(parsed);
}

function requireStringLike(values: unknown[], label: string): string {
  const value = firstString(values);
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function requireTsString(values: unknown[], label: string): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
  }
  throw new Error(`Missing ${label}.`);
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
  }
  return undefined;
}

function maybeTimestampSecondsToMsString(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return String(Math.trunc(value * 1000));
}

function isLikelyOpenzcaListenPayload(record: ReplyMessageRecord): boolean {
  return (
    typeof record.threadId === "string" &&
    (typeof record.senderId === "string" ||
      typeof record.chatType === "string" ||
      typeof record.metadata === "object")
  );
}

function inferReplyMessageThreadId(params: {
  sourceRecord: ReplyMessageRecord;
  canonicalRecord: ReplyMessageRecord;
  metadata?: ReplyMessageRecord;
  threadType?: ThreadType;
  selfId?: string;
}): string | undefined {
  const directThreadId = firstString([
    params.sourceRecord.threadId,
    params.sourceRecord.targetId,
    params.sourceRecord.conversationId,
    params.metadata?.threadId,
    params.metadata?.targetId,
  ]);
  if (directThreadId) {
    return directThreadId;
  }

  if (params.threadType === undefined) {
    return undefined;
  }

  const idTo = firstString([
    params.canonicalRecord.idTo,
    params.sourceRecord.idTo,
    params.sourceRecord.toId,
    params.metadata?.toId,
  ]);
  if (params.threadType === ThreadType.Group) {
    return idTo;
  }

  const uidFrom = firstString([
    params.canonicalRecord.uidFrom,
    params.sourceRecord.uidFrom,
    params.sourceRecord.senderId,
    params.sourceRecord.fromId,
    params.metadata?.senderId,
    params.metadata?.fromId,
  ]);
  if (!uidFrom && !idTo) {
    return undefined;
  }

  if (params.selfId) {
    if (uidFrom && uidFrom !== params.selfId && uidFrom !== "0") {
      return uidFrom;
    }
    if (idTo && idTo !== params.selfId && idTo !== "0") {
      return idTo;
    }
  }

  if (uidFrom && uidFrom !== "0") {
    return uidFrom;
  }
  if (idTo && idTo !== "0") {
    return idTo;
  }
  return undefined;
}
