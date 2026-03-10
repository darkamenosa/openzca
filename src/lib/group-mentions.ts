import type { Mention } from "zca-js";

export type GroupMentionMember = {
  userId: string;
  displayName?: string;
  zaloName?: string;
};

type MentionCandidate = {
  label: string;
  normalizedLabel: string;
  userId: string;
};

const WORD_LIKE_CHAR_RE = /[\p{L}\p{N}_]/u;
const ALLOWED_START_BOUNDARY_CHARS = new Set(["(", "[", "{", "<", "\"", ",", ";", ":"]);
const ALLOWED_END_BOUNDARY_CHARS = new Set([",", ";", ":", "!", "?", ")", "]", "}", ">", "\""]);

export function resolveOutboundGroupMentions(text: string, members: GroupMentionMember[]): Mention[] {
  if (!text.includes("@") || members.length === 0) {
    return [];
  }

  const candidates = buildCandidates(members);
  if (candidates.length === 0) {
    return [];
  }

  const lowerText = text.toLowerCase();
  const mentions: Mention[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    if (!isMentionStartBoundary(text, index)) continue;

    const match = resolveMentionAtIndex(text, lowerText, index, candidates);
    if (!match) continue;

    mentions.push({
      pos: index,
      len: match.label.length + 1,
      uid: match.userId,
    });

    index += match.label.length;
  }

  return mentions;
}

export function hasPotentialOutboundGroupMention(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    if (!isMentionStartBoundary(text, index)) continue;

    const next = text[index + 1];
    if (next && !/\s/u.test(next)) {
      return true;
    }
  }

  return false;
}

function resolveMentionAtIndex(
  text: string,
  lowerText: string,
  atIndex: number,
  candidates: MentionCandidate[],
): MentionCandidate | null {
  const start = atIndex + 1;
  const matches = candidates.filter((candidate) => {
    const end = start + candidate.label.length;
    return (
      lowerText.startsWith(candidate.normalizedLabel, start) &&
      isMentionBoundary(text, start, end)
    );
  });

  if (matches.length === 0) {
    return null;
  }

  const longestLength = matches.reduce((max, candidate) => Math.max(max, candidate.label.length), 0);
  const longestMatches = matches.filter((candidate) => candidate.label.length === longestLength);
  const matchedUserIds = [...new Set(longestMatches.map((candidate) => candidate.userId))];

  if (matchedUserIds.length !== 1) {
    const label = text.slice(atIndex, start + longestLength);
    throw new Error(`Ambiguous mention "${label}": matched multiple group members.`);
  }

  return longestMatches[0];
}

function buildCandidates(members: GroupMentionMember[]): MentionCandidate[] {
  const candidates = new Map<string, MentionCandidate>();

  for (const member of members) {
    const userId = member.userId.trim();
    if (!userId) continue;

    for (const rawLabel of [member.displayName, member.zaloName]) {
      const label = rawLabel?.trim();
      if (!label) continue;

      const normalizedLabel = label.toLowerCase();
      const key = `${userId}\u0000${normalizedLabel}`;
      if (candidates.has(key)) continue;

      candidates.set(key, {
        label,
        normalizedLabel,
        userId,
      });
    }
  }

  return [...candidates.values()].sort((left, right) => right.label.length - left.label.length);
}

function isMentionBoundary(text: string, start: number, end: number): boolean {
  if (end > text.length) {
    return false;
  }

  const next = text[end];
  if (!next) {
    return true;
  }
  if (/\s/u.test(next)) {
    return true;
  }
  if (ALLOWED_END_BOUNDARY_CHARS.has(next)) {
    return true;
  }
  if (next === ".") {
    const following = text[end + 1];
    return !following || /\s/u.test(following) || ALLOWED_END_BOUNDARY_CHARS.has(following);
  }
  return false;
}

function isMentionStartBoundary(text: string, atIndex: number): boolean {
  if (atIndex === 0) {
    return true;
  }

  const previous = text[atIndex - 1];
  return /\s/u.test(previous) || ALLOWED_START_BOUNDARY_CHARS.has(previous);
}

function isWordLikeChar(value: string): boolean {
  return WORD_LIKE_CHAR_RE.test(value);
}
