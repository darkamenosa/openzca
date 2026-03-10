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
