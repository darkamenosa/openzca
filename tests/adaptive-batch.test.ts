import assert from "node:assert/strict";
import test from "node:test";

import { fetchAdaptiveObjectBatches } from "../src/lib/adaptive-batch.ts";

test("fetchAdaptiveObjectBatches splits oversized lookup batches until they succeed", async () => {
  const calls: string[][] = [];
  const ids = Array.from({ length: 12 }, (_, index) => `group-${index + 1}`);

  const result = await fetchAdaptiveObjectBatches(ids, {
    initialBatchSize: 10,
    maxRetries: 0,
    retryDelayMs: 0,
    batchDelayMs: 0,
    fetchBatch: async (keys) => {
      calls.push([...keys]);
      if (keys.length > 5) {
        throw new Error("Tham số không hợp lệ");
      }
      return Object.fromEntries(keys.map((key) => [key, { key }]));
    },
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(Array.from(result.values.keys()), ids);
  assert.deepEqual(calls.map((keys) => keys.length), [10, 5, 5, 2]);
});

test("fetchAdaptiveObjectBatches retries transient lookup failures", async () => {
  let attempts = 0;

  const result = await fetchAdaptiveObjectBatches(["group-1"], {
    initialBatchSize: 1,
    maxRetries: 1,
    retryDelayMs: 0,
    batchDelayMs: 0,
    fetchBatch: async (keys) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("socket hang up");
      }
      return { [keys[0]]: { ok: true } };
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.values.get("group-1"), { ok: true });
});

test("fetchAdaptiveObjectBatches isolates a bad single item after splitting", async () => {
  const calls: string[][] = [];

  const result = await fetchAdaptiveObjectBatches(["group-1", "bad-group", "group-2"], {
    initialBatchSize: 3,
    maxRetries: 0,
    retryDelayMs: 0,
    batchDelayMs: 0,
    fetchBatch: async (keys) => {
      calls.push([...keys]);
      if (keys.includes("bad-group")) {
        throw new Error("Bad request");
      }
      return Object.fromEntries(keys.map((key) => [key, { key }]));
    },
  });

  assert.deepEqual(Array.from(result.values.keys()), ["group-1", "group-2"]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.key, "bad-group");
  assert.deepEqual(calls, [
    ["group-1", "bad-group", "group-2"],
    ["group-1", "bad-group"],
    ["group-1"],
    ["bad-group"],
    ["group-2"],
  ]);
});
