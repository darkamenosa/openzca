import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatePollOptions,
  parsePollId,
  parsePollOptionIds,
} from "../src/lib/group-poll.ts";

test("buildCreatePollOptions trims values and maps optional flags", () => {
  const result = buildCreatePollOptions({
    question: "  Lunch?  ",
    option: ["  Pho  ", " Bun cha "],
    multi: true,
    allowAddOption: true,
    hideVotePreview: true,
    anonymous: true,
    expireMs: "60000",
  });

  assert.deepEqual(result, {
    question: "Lunch?",
    options: ["Pho", "Bun cha"],
    expiredTime: 60000,
    allowMultiChoices: true,
    allowAddNewOption: true,
    hideVotePreview: true,
    isAnonymous: true,
  });
});

test("buildCreatePollOptions rejects a missing question", () => {
  assert.throws(
    () =>
      buildCreatePollOptions({
        question: "   ",
        option: ["One", "Two"],
      }),
    /question/i,
  );
});

test("buildCreatePollOptions rejects fewer than two options", () => {
  assert.throws(
    () =>
      buildCreatePollOptions({
        question: "Lunch?",
        option: ["Only one"],
      }),
    /at least two options/i,
  );
});

test("buildCreatePollOptions rejects blank options", () => {
  assert.throws(
    () =>
      buildCreatePollOptions({
        question: "Lunch?",
        option: ["One", "   "],
      }),
    /option 2/i,
  );
});

test("parsePollId rejects invalid ids", () => {
  assert.throws(() => parsePollId("0"), /poll id/i);
  assert.throws(() => parsePollId("-1"), /poll id/i);
  assert.throws(() => parsePollId("abc"), /poll id/i);
});

test("parsePollOptionIds parses positive integer option ids", () => {
  assert.deepEqual(parsePollOptionIds(["1", "2", "10"]), [1, 2, 10]);
});

test("parsePollOptionIds rejects invalid option ids", () => {
  assert.throws(() => parsePollOptionIds(["1", "0"]), /option id/i);
  assert.throws(() => parsePollOptionIds(["x"]), /option id/i);
});
