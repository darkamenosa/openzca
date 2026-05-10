export type PollIdentifier = number | string;

export interface InboundPollInfo {
  pollId: PollIdentifier
  title?: string
  optionIds?: PollIdentifier[]
}

const POLL_ID_KEYS = new Set(["pollId", "poll_id", "pollID", "pollid"]);
const OPTION_ID_KEYS = new Set(["optionId", "option_id", "optionID", "optionid"]);
const TITLE_KEYS = ["question", "title"];

function looksLikeStructuredJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2)
    return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === "{" && last === "}") || (first === "[" && last === "]");
}

function parseStructuredJsonString(value: string): unknown {
  if (!looksLikeStructuredJsonString(value))
    return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeIdentifier(value: unknown): PollIdentifier | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Number.isSafeInteger(value) ? value : String(value);
  }

  if (typeof value !== "string")
    return undefined;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized))
    return undefined;

  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? numeric : normalized;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

export function extractInboundPollInfo(...values: unknown[]): InboundPollInfo | null {
  const optionIds: PollIdentifier[] = [];
  const seenOptionIds = new Set<string>();
  let pollId: PollIdentifier | undefined;
  let title: string | undefined;

  const pushOptionId = (value: unknown) => {
    const optionId = normalizeIdentifier(value);
    if (!optionId)
      return;
    const key = String(optionId);
    if (seenOptionIds.has(key))
      return;
    seenOptionIds.add(key);
    optionIds.push(optionId);
  };

  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value === null || value === undefined)
      return;

    if (typeof value === "string") {
      const parsed = parseStructuredJsonString(value);
      if (parsed !== undefined)
        visit(parsed, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }

    const record = asRecord(value);
    if (!record)
      return;

    for (const [key, nested] of Object.entries(record)) {
      if (!pollId && POLL_ID_KEYS.has(key)) {
        pollId = normalizeIdentifier(nested);
      }
      if (OPTION_ID_KEYS.has(key)) {
        pushOptionId(nested);
      }
    }

    title ??= firstString(record, TITLE_KEYS);

    for (const nested of Object.values(record)) {
      visit(nested, depth + 1);
    }
  };

  for (const value of values) visit(value);

  if (!pollId)
    return null;

  return {
    pollId,
    ...(title ? { title } : {}),
    ...(optionIds.length > 0 ? { optionIds } : {}),
  };
}
