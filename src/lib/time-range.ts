const DURATION_PART_RE = /(\d+)\s*(ms|s|m|h|d|w)/gi;

function durationToMs(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) {
    return null;
  }

  let total = 0;
  let matched = 0;

  for (const match of text.matchAll(DURATION_PART_RE)) {
    const rawAmount = match[1];
    const unit = match[2];
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }

    matched += match[0].length;

    switch (unit) {
      case "ms":
        total += amount;
        break;
      case "s":
        total += amount * 1000;
        break;
      case "m":
        total += amount * 60 * 1000;
        break;
      case "h":
        total += amount * 60 * 60 * 1000;
        break;
      case "d":
        total += amount * 24 * 60 * 60 * 1000;
        break;
      case "w":
        total += amount * 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        return null;
    }
  }

  if (matched === 0) {
    return null;
  }

  const normalized = text.replace(/\s+/g, "");
  const consumed = Array.from(normalized.matchAll(DURATION_PART_RE))
    .map((match) => match[0])
    .join("");
  if (consumed !== normalized) {
    return null;
  }

  return total;
}

export function parseDurationInput(
  value: string | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const durationMs = durationToMs(value.trim());
  if (durationMs == null) {
    return undefined;
  }

  return nowMs - durationMs;
}

export function parseTimeBoundaryInput(
  value: string | undefined,
  _nowMs = Date.now(),
): number | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return undefined;
}

export function parseTimeInput(
  value: string | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const boundary = parseTimeBoundaryInput(trimmed, nowMs);
  if (boundary !== undefined) {
    return boundary;
  }

  const duration = parseDurationInput(trimmed, nowMs);
  if (duration !== undefined) {
    return duration;
  }

  return undefined;
}
