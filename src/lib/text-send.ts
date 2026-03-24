import { ThreadType, type Mention, type Style } from "zca-js";

import {
  hasPotentialOutboundGroupMention,
  resolveOutboundGroupMentions,
  type GroupMentionMember,
} from "./group-mentions.js";
import { parseTextStyles } from "./text-styles.js";

export const ZALO_TEXT_MESSAGE_MAX_LENGTH = 2000;
export const ZALO_TEXT_REQUEST_PARAMS_MAX_ESTIMATE = 4000;

export type TextSendPayload =
  | string
  | {
      msg: string;
      styles?: Style[];
      mentions?: Mention[];
    };

export type TextSendPayloadAnalysis = {
  payload: TextSendPayload;
  payloadObject: {
    msg: string;
    styles?: Style[];
    mentions?: Mention[];
  };
  rawInputLength: number;
  renderedTextLength: number;
  styleCount: number;
  mentionCount: number;
  textPropertiesLength: number;
  mentionInfoLength: number;
  requestParamsLengthEstimate: number;
  sendPath: "sms" | "sendmsg" | "mention";
};

type NormalizedTextSendPayload = {
  msg: string;
  styles?: Style[];
  mentions?: Mention[];
};

export type TextSendDeliveryPlan = {
  chunks: TextSendPayload[];
  analyses: TextSendPayloadAnalysis[];
};

export async function buildTextSendPayload(params: {
  message: string;
  raw?: boolean;
  threadType: ThreadType;
  threadId: string;
  listGroupMembers?: (threadId: string) => Promise<GroupMentionMember[]>;
}): Promise<TextSendPayload> {
  if (params.raw) {
    const mentions = await resolveGroupMentionsIfNeeded(params, params.message);
    return mentions ? { msg: params.message, mentions } : params.message;
  }

  const { text, styles } = parseTextStyles(params.message);
  const mentions = await resolveGroupMentionsIfNeeded(params, text);
  return {
    msg: text,
    styles: styles.length > 0 ? styles : undefined,
    mentions,
  };
}

export async function analyzeTextSendPayload(params: {
  message: string;
  raw?: boolean;
  threadType: ThreadType;
  threadId: string;
  listGroupMembers?: (threadId: string) => Promise<GroupMentionMember[]>;
}): Promise<TextSendPayloadAnalysis> {
  const payload = await buildTextSendPayload(params);
  const payloadObject = normalizeTextSendPayload(payload);
  const textProperties = buildTextProperties(payloadObject.styles);
  const mentionInfo = buildMentionInfo(
    params.threadType,
    payloadObject.msg,
    payloadObject.mentions,
  );

  const requestParams = omitUndefined({
    message: payloadObject.msg,
    clientId: 1_700_000_000_000,
    mentionInfo,
    imei: params.threadType === ThreadType.Group ? undefined : "000000000000000",
    ttl: 0,
    visibility: params.threadType === ThreadType.Group ? 0 : undefined,
    toid: params.threadType === ThreadType.Group ? undefined : params.threadId,
    grid: params.threadType === ThreadType.Group ? params.threadId : undefined,
    textProperties,
  });

  return {
    payload,
    ...buildTextSendPayloadAnalysis({
      payloadObject,
      rawInputLength: params.message.length,
      textProperties,
      mentionInfo,
      requestParamsLengthEstimate: JSON.stringify(requestParams).length,
      threadType: params.threadType,
    }),
  };
}

export function planTextSendPayloadsForDelivery(params: {
  payload: TextSendPayload;
  threadType: ThreadType;
  threadId: string;
  maxMessageLength?: number;
  maxRequestParamsLengthEstimate?: number;
}): TextSendDeliveryPlan {
  const maxMessageLength = resolvePositiveLimit(
    params.maxMessageLength,
    ZALO_TEXT_MESSAGE_MAX_LENGTH,
  );
  const maxRequestParamsLengthEstimate = resolvePositiveLimit(
    params.maxRequestParamsLengthEstimate,
    ZALO_TEXT_REQUEST_PARAMS_MAX_ESTIMATE,
  );

  const chunks: TextSendPayload[] = [];
  const analyses: TextSendPayloadAnalysis[] = [];
  const pending: TextSendPayload[] = [params.payload];

  while (pending.length > 0) {
    const currentPayload = pending.shift()!;
    const analysis = analyzePreparedTextSendPayload({
      payload: currentPayload,
      threadType: params.threadType,
      threadId: params.threadId,
    });

    if (
      isTextSendPayloadWithinDeliveryLimits(analysis, {
        maxMessageLength,
        maxRequestParamsLengthEstimate,
      })
    ) {
      chunks.push(currentPayload);
      analyses.push(analysis);
      continue;
    }

    const targetLength = computeNextChunkLength(analysis, {
      maxMessageLength,
      maxRequestParamsLengthEstimate,
    });
    const splitChunks = splitTextSendPayload(currentPayload, targetLength);
    if (splitChunks.length <= 1) {
      throw new Error(
        `Unable to split formatted text payload into deliverable chunks within ${targetLength} characters.`,
      );
    }
    pending.unshift(...splitChunks);
  }

  return { chunks, analyses };
}

export function splitTextSendPayload(
  payload: TextSendPayload,
  maxLength = ZALO_TEXT_MESSAGE_MAX_LENGTH,
): TextSendPayload[] {
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new Error("Text chunk size must be a positive integer");
  }

  const payloadObject = normalizeTextSendPayload(payload);
  if (payloadObject.msg.length <= maxLength) {
    return [payload];
  }

  const chunks: TextSendPayload[] = [];
  let start = 0;
  while (start < payloadObject.msg.length) {
    const end = findChunkEnd(payloadObject, start, maxLength);
    chunks.push(sliceTextSendPayload(payloadObject, start, end));
    start = end;
  }
  return chunks;
}

function analyzePreparedTextSendPayload(params: {
  payload: TextSendPayload;
  threadType: ThreadType;
  threadId: string;
}): TextSendPayloadAnalysis {
  const payloadObject = normalizeTextSendPayload(params.payload);
  const textProperties = buildTextProperties(payloadObject.styles);
  const mentionInfo = buildMentionInfo(
    params.threadType,
    payloadObject.msg,
    payloadObject.mentions,
  );

  const requestParams = omitUndefined({
    message: payloadObject.msg,
    clientId: 1_700_000_000_000,
    mentionInfo,
    imei: params.threadType === ThreadType.Group ? undefined : "000000000000000",
    ttl: 0,
    visibility: params.threadType === ThreadType.Group ? 0 : undefined,
    toid: params.threadType === ThreadType.Group ? undefined : params.threadId,
    grid: params.threadType === ThreadType.Group ? params.threadId : undefined,
    textProperties,
  });

  return {
    payload: params.payload,
    ...buildTextSendPayloadAnalysis({
      payloadObject,
      rawInputLength: payloadObject.msg.length,
      textProperties,
      mentionInfo,
      requestParamsLengthEstimate: JSON.stringify(requestParams).length,
      threadType: params.threadType,
    }),
  };
}

async function resolveGroupMentionsIfNeeded(
  params: {
    threadType: ThreadType;
    threadId: string;
    listGroupMembers?: (threadId: string) => Promise<GroupMentionMember[]>;
  },
  text: string,
): Promise<Mention[] | undefined> {
  if (params.threadType !== ThreadType.Group) {
    return undefined;
  }
  if (!hasPotentialOutboundGroupMention(text)) {
    return undefined;
  }
  if (!params.listGroupMembers) {
    return undefined;
  }

  const members = await params.listGroupMembers(params.threadId);
  const mentions = resolveOutboundGroupMentions(text, members);
  return mentions.length > 0 ? mentions : undefined;
}

function normalizeTextSendPayload(payload: TextSendPayload): {
  msg: string;
  styles?: Style[];
  mentions?: Mention[];
} {
  if (typeof payload === "string") {
    return { msg: payload };
  }
  return payload;
}

function buildTextSendPayloadAnalysis(params: {
  payloadObject: NormalizedTextSendPayload;
  rawInputLength: number;
  textProperties: string | undefined;
  mentionInfo: string | undefined;
  requestParamsLengthEstimate: number;
  threadType: ThreadType;
}): Omit<TextSendPayloadAnalysis, "payload"> {
  return {
    payloadObject: params.payloadObject,
    rawInputLength: params.rawInputLength,
    renderedTextLength: params.payloadObject.msg.length,
    styleCount: params.payloadObject.styles?.length ?? 0,
    mentionCount: params.payloadObject.mentions?.length ?? 0,
    textPropertiesLength: params.textProperties?.length ?? 0,
    mentionInfoLength: params.mentionInfo?.length ?? 0,
    requestParamsLengthEstimate: params.requestParamsLengthEstimate,
    sendPath:
      params.threadType === ThreadType.Group
        ? params.mentionInfo
          ? "mention"
          : "sendmsg"
        : "sms",
  };
}

function isTextSendPayloadWithinDeliveryLimits(
  analysis: TextSendPayloadAnalysis,
  limits: {
    maxMessageLength: number;
    maxRequestParamsLengthEstimate: number;
  },
): boolean {
  return (
    analysis.renderedTextLength <= limits.maxMessageLength &&
    analysis.requestParamsLengthEstimate <= limits.maxRequestParamsLengthEstimate
  );
}

function computeNextChunkLength(
  analysis: TextSendPayloadAnalysis,
  limits: {
    maxMessageLength: number;
    maxRequestParamsLengthEstimate: number;
  },
): number {
  const currentLength = analysis.renderedTextLength;
  const targetLengths = [limits.maxMessageLength, currentLength - 1].filter((value) => value > 0);

  if (analysis.requestParamsLengthEstimate > limits.maxRequestParamsLengthEstimate) {
    targetLengths.push(
      Math.floor(
        (currentLength * limits.maxRequestParamsLengthEstimate) /
          analysis.requestParamsLengthEstimate,
      ),
    );
  }

  const targetLength = Math.max(
    1,
    Math.min(...targetLengths.filter((value) => Number.isFinite(value) && value > 0)),
  );

  return Math.min(targetLength, currentLength - 1);
}

function resolvePositiveLimit(value: number | undefined, fallback: number): number {
  if (!value || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function sliceTextSendPayload(
  payloadObject: NormalizedTextSendPayload,
  start: number,
  end: number,
): TextSendPayload {
  const msg = payloadObject.msg.slice(start, end);
  const styles = sliceStyles(payloadObject.styles, start, end);
  const mentions = sliceMentions(payloadObject.mentions, start, end);

  if (!styles && !mentions) {
    return msg;
  }

  return omitUndefined({
    msg,
    styles,
    mentions,
  });
}

function sliceStyles(
  styles: Style[] | undefined,
  start: number,
  end: number,
): Style[] | undefined {
  if (!styles || styles.length === 0) {
    return undefined;
  }

  const sliced: Style[] = [];
  for (const style of styles) {
    const styleStart = style.start;
    const styleEnd = style.start + style.len;
    const overlapStart = Math.max(styleStart, start);
    const overlapEnd = Math.min(styleEnd, end);

    if (overlapStart >= overlapEnd) {
      continue;
    }

    if (style.st === "ind_$") {
      sliced.push({
        start: overlapStart - start,
        len: overlapEnd - overlapStart,
        st: style.st,
        indentSize: style.indentSize,
      });
      continue;
    }

    sliced.push({
      start: overlapStart - start,
      len: overlapEnd - overlapStart,
      st: style.st,
    });
  }

  return sliced.length > 0 ? sliced : undefined;
}

function sliceMentions(
  mentions: Mention[] | undefined,
  start: number,
  end: number,
): Mention[] | undefined {
  if (!mentions || mentions.length === 0) {
    return undefined;
  }

  const sliced = mentions
    .filter((mention) => mention.pos >= start && mention.pos + mention.len <= end)
    .map((mention) => ({
      pos: mention.pos - start,
      uid: mention.uid,
      len: mention.len,
    }));

  return sliced.length > 0 ? sliced : undefined;
}

function findChunkEnd(
  payloadObject: NormalizedTextSendPayload,
  start: number,
  maxLength: number,
): number {
  const remaining = payloadObject.msg.length - start;
  if (remaining <= maxLength) {
    return payloadObject.msg.length;
  }

  const maxEnd = start + maxLength;

  const newlineBreak = findPreferredBreak(payloadObject, start, maxEnd, "\n");
  if (newlineBreak > start) {
    return newlineBreak;
  }

  const whitespaceBreak = findWhitespaceBreak(payloadObject, start, maxEnd);
  if (whitespaceBreak > start) {
    return whitespaceBreak;
  }

  for (let cursor = maxEnd; cursor > start; cursor -= 1) {
    if (isSafeSplitPosition(payloadObject.mentions, cursor)) {
      return cursor;
    }
  }

  throw new Error(
    `Unable to split text payload safely within ${maxLength} characters.`,
  );
}

function findPreferredBreak(
  payloadObject: NormalizedTextSendPayload,
  start: number,
  maxEnd: number,
  marker: string,
): number {
  for (let cursor = maxEnd; cursor > start; cursor -= 1) {
    if (!isSafeSplitPosition(payloadObject.mentions, cursor)) {
      continue;
    }
    if (payloadObject.msg[cursor - 1] === marker) {
      return cursor;
    }
  }
  return start;
}

function findWhitespaceBreak(
  payloadObject: NormalizedTextSendPayload,
  start: number,
  maxEnd: number,
): number {
  for (let cursor = maxEnd; cursor > start; cursor -= 1) {
    if (!isSafeSplitPosition(payloadObject.mentions, cursor)) {
      continue;
    }
    const previousChar = payloadObject.msg[cursor - 1];
    if (previousChar === " " || previousChar === "\t") {
      return cursor;
    }
  }
  return start;
}

function isSafeSplitPosition(mentions: Mention[] | undefined, position: number): boolean {
  if (!mentions || mentions.length === 0) {
    return true;
  }

  return mentions.every((mention) => {
    const mentionEnd = mention.pos + mention.len;
    return position <= mention.pos || position >= mentionEnd;
  });
}

function buildTextProperties(styles?: Style[]): string | undefined {
  if (!styles || styles.length === 0) {
    return undefined;
  }

  return JSON.stringify({
    styles: styles.map((style) => {
      if (style.st === "ind_$") {
        return omitUndefined({
          start: style.start,
          len: style.len,
          st: `ind_${style.indentSize ?? 1}0`,
        });
      }
      return {
        start: style.start,
        len: style.len,
        st: style.st,
      };
    }),
    ver: 0,
  });
}

function buildMentionInfo(
  threadType: ThreadType,
  msg: string,
  mentions?: Mention[],
): string | undefined {
  if (threadType !== ThreadType.Group || !mentions || mentions.length === 0) {
    return undefined;
  }

  let totalMentionLen = 0;
  const mentionsFinal = mentions
    .filter((mention) => mention.pos >= 0 && Boolean(mention.uid) && mention.len > 0)
    .map((mention) => {
      totalMentionLen += mention.len;
      return {
        pos: mention.pos,
        uid: mention.uid,
        len: mention.len,
        type: mention.uid === "-1" ? 1 : 0,
      };
    });

  if (totalMentionLen > msg.length) {
    throw new Error("Invalid mentions: total mention characters exceed message length");
  }
  if (mentionsFinal.length === 0) {
    return undefined;
  }
  return JSON.stringify(mentionsFinal);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
