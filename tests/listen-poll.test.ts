import assert from "node:assert/strict";
import { test } from "vitest";

import { extractInboundPollInfo } from "../src/lib/listen-poll.ts";

test("extractInboundPollInfo reads poll_id and option ids from message content", () => {
  const result = extractInboundPollInfo({
    msgType: "group.poll",
    content: {
      poll_id: 12345,
      question: "Lunch?",
      options: [
        { option_id: 11, content: "Pho" },
        { option_id: "12", content: "Bun bo" },
      ],
    },
  });

  assert.deepEqual(result, {
    pollId: 12345,
    title: "Lunch?",
    optionIds: [11, 12],
  });
});

test("extractInboundPollInfo reads pollId from JSON group topic params", () => {
  const result = extractInboundPollInfo({
    type: "update_board",
    data: {
      groupId: "2537057503136799281",
      groupTopic: {
        type: 3,
        params: JSON.stringify({
          pollId: 98765,
          title: "Trua nay an gi?",
        }),
      },
    },
  });

  assert.deepEqual(result, {
    pollId: 98765,
    title: "Trua nay an gi?",
  });
});

test("extractInboundPollInfo preserves unsafe numeric string ids", () => {
  const result = extractInboundPollInfo({
    poll_id: "9007199254740999",
    question: "Large id?",
  });

  assert.deepEqual(result, {
    pollId: "9007199254740999",
    title: "Large id?",
  });
});

test("extractInboundPollInfo ignores non-poll payloads", () => {
  assert.equal(
    extractInboundPollInfo({
      title: "Link preview",
      href: "https://example.test",
    }),
    null,
  );
});
