import type { CreatePollOptions } from "zca-js";

export type CreateGroupPollCliOptions = {
  question?: string;
  option?: string[];
  multi?: boolean;
  allowAddOption?: boolean;
  hideVotePreview?: boolean;
  anonymous?: boolean;
  expireMs?: string;
};

function parsePositiveInteger(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function requireQuestion(value?: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error("Poll question is required.");
  }
  return normalized;
}

function normalizeOptions(values?: string[]): string[] {
  const normalized = (values ?? []).map((value) => value.trim());
  if (normalized.length < 2) {
    throw new Error("Poll must include at least two options.");
  }

  for (let index = 0; index < normalized.length; index += 1) {
    if (!normalized[index]) {
      throw new Error(`Poll option ${index + 1} cannot be empty.`);
    }
  }

  return normalized;
}

export function parsePollId(value: string): number {
  return parsePositiveInteger(value, "Poll id");
}

export function parsePollOptionIds(values?: string[]): number[] {
  const optionIds = values ?? [];
  if (optionIds.length === 0) {
    throw new Error("Provide at least one option id.");
  }
  return optionIds.map((value) => parsePositiveInteger(value, "Option id"));
}

export function buildCreatePollOptions(
  options: CreateGroupPollCliOptions,
): CreatePollOptions {
  const expireMs = options.expireMs?.trim();

  return {
    question: requireQuestion(options.question),
    options: normalizeOptions(options.option),
    expiredTime: expireMs ? parsePositiveInteger(expireMs, "expire-ms") : undefined,
    allowMultiChoices: Boolean(options.multi),
    allowAddNewOption: Boolean(options.allowAddOption),
    hideVotePreview: Boolean(options.hideVotePreview),
    isAnonymous: Boolean(options.anonymous),
  };
}
