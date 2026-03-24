import { ThreadType, type Mention, type Style } from "zca-js";

import {
  hasPotentialOutboundGroupMention,
  resolveOutboundGroupMentions,
  type GroupMentionMember,
} from "./group-mentions.js";
import { parseTextStyles } from "./text-styles.js";

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
    payloadObject,
    rawInputLength: params.message.length,
    renderedTextLength: payloadObject.msg.length,
    styleCount: payloadObject.styles?.length ?? 0,
    mentionCount: payloadObject.mentions?.length ?? 0,
    textPropertiesLength: textProperties?.length ?? 0,
    mentionInfoLength: mentionInfo?.length ?? 0,
    requestParamsLengthEstimate: JSON.stringify(requestParams).length,
    sendPath:
      params.threadType === ThreadType.Group
        ? mentionInfo
          ? "mention"
          : "sendmsg"
        : "sms",
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
