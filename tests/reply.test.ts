import assert from "node:assert/strict";
import test from "node:test";

import { ThreadType } from "zca-js";

import { prepareReplyMessage, prepareStoredReplyMessage } from "../src/lib/reply.ts";

test("prepareReplyMessage builds a sendable quote from raw message data", () => {
  const result = prepareReplyMessage(
    {
      content: "alo",
      msgType: "webchat",
      propertyExt: {
        color: 0,
        size: 0,
        type: 0,
        subType: 0,
        ext: "{}",
      },
      uidFrom: "peer-1",
      idTo: "self-1",
      msgId: "m1",
      cliMsgId: "c1",
      ts: "1774152480556",
      ttl: 0,
    },
    {
      threadType: ThreadType.User,
      selfId: "self-1",
    },
  );

  assert.deepEqual(result.quote, {
    content: "alo",
    msgType: "webchat",
    propertyExt: {
      color: 0,
      size: 0,
      type: 0,
      subType: 0,
      ext: "{}",
    },
    uidFrom: "peer-1",
    msgId: "m1",
    cliMsgId: "c1",
    ts: "1774152480556",
    ttl: 0,
  });
  assert.equal(result.inferredThreadId, "peer-1");
});

test("prepareReplyMessage infers group thread id from raw message data", () => {
  const result = prepareReplyMessage(
    {
      content: "group message",
      msgType: "webchat",
      uidFrom: "peer-1",
      idTo: "group-9",
      msgId: "m1",
      cliMsgId: "c1",
      ts: "1774152530188",
      ttl: "0",
    },
    {
      threadType: ThreadType.Group,
      selfId: "self-1",
    },
  );

  assert.equal(result.inferredThreadId, "group-9");
  assert.equal(result.quote.ttl, 0);
});

test("prepareReplyMessage accepts openzca listen payloads for DM text", () => {
  const result = prepareReplyMessage(
    {
      threadId: "1543478002790642374",
      targetId: "1543478002790642374",
      conversationId: "1543478002790642374",
      msgId: "7645528516660",
      cliMsgId: "1774152479593",
      content: "alo",
      type: 0,
      timestamp: 1774152480,
      msgType: "webchat",
      metadata: {
        isGroup: false,
        chatType: "user",
        threadId: "1543478002790642374",
        targetId: "1543478002790642374",
        senderDisplayName: "Tuyen",
        senderId: "1543478002790642374",
        fromId: "1543478002790642374",
        toId: "613062475174659631",
        msgType: "webchat",
        timestamp: 1774152480,
      },
      chatType: "user",
      senderId: "1543478002790642374",
      senderName: "Tuyen",
      senderDisplayName: "Tuyen",
      toId: "613062475174659631",
      ts: "1774152480556",
    },
    {
      threadType: ThreadType.User,
      selfId: "613062475174659631",
    },
  );

  assert.equal(result.inferredThreadId, "1543478002790642374");
  assert.deepEqual(result.quote, {
    content: "alo",
    msgType: "webchat",
    propertyExt: undefined,
    uidFrom: "1543478002790642374",
    msgId: "7645528516660",
    cliMsgId: "1774152479593",
    ts: "1774152480556",
    ttl: 0,
  });
});

test("prepareReplyMessage strips appended reply context from openzca listen payloads", () => {
  const result = prepareReplyMessage(
    {
      threadId: "2465050216833440664",
      targetId: "2465050216833440664",
      conversationId: "2465050216833440664",
      msgId: "7645530765413",
      cliMsgId: "1774152529301",
      content:
        "@Mon quote tin nhan trong group ne\n[reply context: Thu: sample]\n[reply media attached: /tmp/file]",
      type: 1,
      timestamp: 1774152530,
      msgType: "webchat",
      senderId: "1543478002790642374",
      toId: "2465050216833440664",
      ts: "1774152530188",
      metadata: {
        isGroup: true,
        threadId: "2465050216833440664",
        senderId: "1543478002790642374",
        toId: "2465050216833440664",
        msgType: "webchat",
      },
    },
    {
      threadType: ThreadType.Group,
      selfId: "613062475174659631",
    },
  );

  assert.equal(result.inferredThreadId, "2465050216833440664");
  assert.equal(result.quote.content, "@Mon quote tin nhan trong group ne");
});

test("prepareReplyMessage rejects missing required raw message fields", () => {
  assert.throws(
    () =>
      prepareReplyMessage({
        msgType: "webchat",
        uidFrom: "peer-1",
        msgId: "m1",
        cliMsgId: "c1",
        ts: "1774152480556",
        ttl: 0,
      }),
    /reply message content/i,
  );
});

test("prepareReplyMessage rejects invalid propertyExt values", () => {
  assert.throws(
    () =>
      prepareReplyMessage({
        content: "alo",
        msgType: "webchat",
        propertyExt: "bad",
        uidFrom: "peer-1",
        msgId: "m1",
        cliMsgId: "c1",
        ts: "1774152480556",
        ttl: 0,
      }),
    /propertyExt/i,
  );
});

test("prepareStoredReplyMessage validates thread identity and uses stored rawMessage", () => {
  const result = prepareStoredReplyMessage(
    {
      threadId: "peer-1",
      threadType: "user",
      rawMessage: {
        content: "alo",
        msgType: "webchat",
        uidFrom: "peer-1",
        idTo: "self-1",
        msgId: "m1",
        cliMsgId: "c1",
        ts: "1774152480556",
        ttl: 0,
      },
    },
    {
      threadId: "peer-1",
      threadType: ThreadType.User,
      selfId: "self-1",
    },
  );

  assert.equal(result.msgId, "m1");
  assert.equal(result.uidFrom, "peer-1");
});

test("prepareStoredReplyMessage rejects mismatched stored thread ids", () => {
  assert.throws(
    () =>
      prepareStoredReplyMessage(
        {
          threadId: "peer-2",
          threadType: "user",
          rawMessage: {
            content: "alo",
            msgType: "webchat",
            uidFrom: "peer-1",
            idTo: "self-1",
            msgId: "m1",
            cliMsgId: "c1",
            ts: "1774152480556",
            ttl: 0,
          },
        },
        {
          threadId: "peer-1",
          threadType: ThreadType.User,
          selfId: "self-1",
        },
      ),
    /different thread/i,
  );
});
