export type AdaptiveBatchLookupError = {
  key: string;
  error: unknown;
};

export type AdaptiveBatchRetryContext = {
  keys: string[];
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: unknown;
};

export type FetchAdaptiveObjectBatchesOptions<TValue> = {
  fetchBatch: (keys: string[]) => Promise<Record<string, TValue | undefined> | undefined>;
  initialBatchSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  batchDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
  shouldSplit?: (error: unknown) => boolean;
  continueOnItemError?: boolean;
  onRetry?: (context: AdaptiveBatchRetryContext) => void | Promise<void>;
  onItemError?: (context: AdaptiveBatchLookupError) => void | Promise<void>;
};

const RETRYABLE_LOOKUP_ERROR_PATTERNS = [
  /retry limit/i,
  /\brate limit/i,
  /\btoo many requests?\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
  /\besockettimedout\b/i,
  /\bsocket hang up\b/i,
  /\btemporar(?:y|ily)\b/i,
] as const;

const SPLITTABLE_LOOKUP_ERROR_PATTERNS = [
  /\binvalid param(?:eter)?s?\b/i,
  /\binvalid request\b/i,
  /\bbad request\b/i,
  /tham so khong hop le/i,
  /tham số không hợp lệ/i,
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function chunkKeys(keys: string[], size: number): string[][] {
  const chunkSize = Math.max(1, Math.trunc(size) || 1);
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += chunkSize) {
    chunks.push(keys.slice(index, index + chunkSize));
  }
  return chunks;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableLookupError(error: unknown): boolean {
  const message = toErrorText(error);
  return RETRYABLE_LOOKUP_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function isSplittableLookupError(error: unknown): boolean {
  const message = toErrorText(error);
  return SPLITTABLE_LOOKUP_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function runAdaptiveBatch<TValue>(
  keys: string[],
  options: FetchAdaptiveObjectBatchesOptions<TValue>,
): Promise<Record<string, TValue | undefined>> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const initialDelayMs = Math.max(0, options.retryDelayMs ?? 400);
  const backoffMultiplier = Math.max(1, options.backoffMultiplier ?? 2);
  const shouldRetry = options.shouldRetry ?? isRetryableLookupError;
  const shouldSplit = options.shouldSplit ?? isSplittableLookupError;
  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return (await options.fetchBatch(keys)) ?? {};
    } catch (error) {
      if (keys.length > 1 && shouldSplit(error)) {
        throw error;
      }
      attempt += 1;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }
      await options.onRetry?.({
        keys: [...keys],
        attempt,
        maxRetries,
        delayMs,
        error,
      });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      delayMs = Math.max(delayMs * backoffMultiplier, delayMs + 1);
    }
  }
}

export async function fetchAdaptiveObjectBatches<TValue>(
  keys: readonly string[],
  options: FetchAdaptiveObjectBatchesOptions<TValue>,
): Promise<{ values: Map<string, TValue>; errors: AdaptiveBatchLookupError[] }> {
  const uniqueKeys = Array.from(new Set(keys.map((value) => value.trim()).filter(Boolean)));
  const pending = chunkKeys(uniqueKeys, options.initialBatchSize ?? 5);
  const values = new Map<string, TValue>();
  const errors: AdaptiveBatchLookupError[] = [];
  const shouldRetry = options.shouldRetry ?? isRetryableLookupError;
  const shouldSplit = options.shouldSplit ?? isSplittableLookupError;
  const continueOnItemError = options.continueOnItemError ?? true;
  const batchDelayMs = Math.max(0, options.batchDelayMs ?? 75);

  while (pending.length > 0) {
    const batch = pending.shift();
    if (!batch || batch.length === 0) {
      continue;
    }

    try {
      const result = await runAdaptiveBatch(batch, options);
      for (const key of batch) {
        const value = result[key];
        if (value !== undefined) {
          values.set(key, value);
        }
      }
    } catch (error) {
      if (batch.length > 1 && (shouldSplit(error) || shouldRetry(error))) {
        pending.unshift(...chunkKeys(batch, Math.ceil(batch.length / 2)));
        continue;
      }
      if (!continueOnItemError || batch.length > 1) {
        throw error;
      }
      const itemError = { key: batch[0], error };
      errors.push(itemError);
      await options.onItemError?.(itemError);
      continue;
    }

    if (batchDelayMs > 0 && pending.length > 0) {
      await sleep(batchDelayMs);
    }
  }

  return { values, errors };
}
