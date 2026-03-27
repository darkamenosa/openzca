import assert from "node:assert/strict";
import test from "node:test";

import {
  getSendRetryConfigFromEnv,
  isRetryableSendError,
  retryable,
} from "./send-retry.js";

test("isRetryableSendError matches transient transport failures", () => {
  assert.equal(isRetryableSendError(new Error("Retry limit")), true);
  assert.equal(isRetryableSendError(new Error("socket hang up")), true);
  assert.equal(isRetryableSendError(new Error("Timed out waiting for response")), true);
  assert.equal(isRetryableSendError(new Error("ETIMEDOUT")), true);
  assert.equal(isRetryableSendError(new Error("Validation failed")), false);
});

test("getSendRetryConfigFromEnv reads env overrides", () => {
  assert.deepEqual(
    getSendRetryConfigFromEnv({
      ...process.env,
      OPENZCA_SEND_RETRY_COUNT: "2",
      OPENZCA_SEND_RETRY_DELAY_MS: "1500",
    }),
    { number: 2, delayMs: 1500 },
  );

  assert.deepEqual(
    getSendRetryConfigFromEnv({
      ...process.env,
      OPENZCA_SEND_RETRY_COUNT: "0",
      OPENZCA_SEND_RETRY_DELAY_MS: "0",
    }),
    { number: 0, delayMs: 0 },
  );
});

test("retryable retries once for retryable failures", async () => {
  let calls = 0;
  const attempts: number[] = [];

  const send = retryable(
    async (value: string) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Retry limit");
      }
      return value;
    },
    {
      number: 1,
      delayMs: 0,
      onRetry: ({ attempt }) => {
        attempts.push(attempt);
      },
    },
  );

  const result = await send("ok");

  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(attempts, [1]);
});

test("retryable does not retry non-retryable failures", async () => {
  let calls = 0;
  const send = retryable(
    async () => {
      calls += 1;
      throw new Error("Bad request");
    },
    {
      number: 1,
      delayMs: 0,
    },
  );

  await assert.rejects(send, /Bad request/);
  assert.equal(calls, 1);
});
