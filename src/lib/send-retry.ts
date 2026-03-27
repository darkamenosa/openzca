export type RetryPredicate = (error: unknown) => boolean;

export type RetryableOptions<TArgs extends unknown[]> = {
  number?: number;
  delayMs?: number;
  on?: RetryPredicate;
  onRetry?: (context: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: unknown;
    args: TArgs;
  }) => void | Promise<void>;
};

export type SendRetryConfig = Pick<RetryableOptions<unknown[]>, "number" | "delayMs">;

const DEFAULT_SEND_RETRY_COUNT = 1;
const DEFAULT_SEND_RETRY_DELAY_MS = 750;

const RETRYABLE_SEND_ERROR_PATTERNS = [
  /retry limit/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
  /\besockettimedout\b/i,
  /\bsocket hang up\b/i,
  /\btemporar(?:y|ily)\b/i,
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (raw === "0") return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSendRetryConfigFromEnv(env = process.env): SendRetryConfig {
  return {
    number: parsePositiveIntEnv(env.OPENZCA_SEND_RETRY_COUNT, DEFAULT_SEND_RETRY_COUNT),
    delayMs: parsePositiveIntEnv(env.OPENZCA_SEND_RETRY_DELAY_MS, DEFAULT_SEND_RETRY_DELAY_MS),
  };
}

export function isRetryableSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return RETRYABLE_SEND_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function retryable<TArgs extends unknown[], TResult>(
  operation: (...args: TArgs) => Promise<TResult>,
  options?: RetryableOptions<TArgs>,
): (...args: TArgs) => Promise<TResult> {
  const maxRetries = Math.max(0, options?.number ?? DEFAULT_SEND_RETRY_COUNT);
  const delayMs = Math.max(0, options?.delayMs ?? DEFAULT_SEND_RETRY_DELAY_MS);
  const shouldRetry = options?.on ?? isRetryableSendError;

  return async (...args: TArgs): Promise<TResult> => {
    let attempt = 0;
    while (true) {
      try {
        return await operation(...args);
      } catch (error) {
        attempt += 1;
        if (attempt > maxRetries || !shouldRetry(error)) {
          throw error;
        }
        await options?.onRetry?.({
          attempt,
          maxRetries,
          delayMs,
          error,
          args,
        });
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  };
}
