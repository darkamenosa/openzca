import assert from "node:assert/strict";
import test from "node:test";

import { TextStyle, ThreadType } from "zca-js";

import type { GroupMentionMember } from "./group-mentions.js";

type BuildTextSendPayload = (params: {
  message: string;
  raw?: boolean;
  threadType: ThreadType;
  threadId: string;
  listGroupMembers?: (threadId: string) => Promise<GroupMentionMember[]>;
}) => Promise<unknown>;

async function loadBuilder(): Promise<BuildTextSendPayload> {
  const loaded = (await import("./text-send.js").catch(() => ({}))) as {
    buildTextSendPayload?: BuildTextSendPayload;
  };
  assert.equal(typeof loaded.buildTextSendPayload, "function");
  return loaded.buildTextSendPayload!;
}

test("builds a raw group payload with mentions and calls the member lookup", async () => {
  const buildTextSendPayload = await loadBuilder();
  const lookupCalls: string[] = [];

  const payload = await buildTextSendPayload({
    message: "hi @Alice",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async (threadId) => {
      lookupCalls.push(threadId);
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.deepStrictEqual(lookupCalls, ["group-1"]);
  assert.deepStrictEqual(payload, {
    msg: "hi @Alice",
    mentions: [{ pos: 3, len: 6, uid: "1" }],
  });
});

test("builds a raw group payload resolving a member id mention", async () => {
  const buildTextSendPayload = await loadBuilder();

  const payload = await buildTextSendPayload({
    message: "hi @123456789",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => [{ userId: "123456789", displayName: "Alice" }],
  });

  assert.deepStrictEqual(payload, {
    msg: "hi @123456789",
    mentions: [{ pos: 3, len: 10, uid: "123456789" }],
  });
});

test("builds a formatted group payload with styles and mention offsets from final text", async () => {
  const buildTextSendPayload = await loadBuilder();

  const payload = await buildTextSendPayload({
    message: "**@Alice** hello",
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => [{ userId: "1", displayName: "Alice" }],
  });

  assert.deepStrictEqual(payload, {
    msg: "@Alice hello",
    styles: [{ start: 0, len: 6, st: TextStyle.Bold }],
    mentions: [{ pos: 0, len: 6, uid: "1" }],
  });
});

test("skips group member lookup when there is no plausible mention marker", async () => {
  const buildTextSendPayload = await loadBuilder();
  let lookupCount = 0;

  const payload = await buildTextSendPayload({
    message: "contact me at name@example.com",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => {
      lookupCount += 1;
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.equal(lookupCount, 0);
  assert.equal(payload, "contact me at name@example.com");
});

test("never performs group mention resolution for direct messages", async () => {
  const buildTextSendPayload = await loadBuilder();
  let lookupCount = 0;

  const payload = await buildTextSendPayload({
    message: "hi @Alice",
    raw: true,
    threadType: ThreadType.User,
    threadId: "user-1",
    listGroupMembers: async () => {
      lookupCount += 1;
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.equal(lookupCount, 0);
  assert.equal(payload, "hi @Alice");
});
