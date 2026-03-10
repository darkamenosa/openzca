import assert from "node:assert/strict";
import test from "node:test";

import type { Mention } from "zca-js";

import { parseTextStyles } from "./text-styles.js";

type GroupMentionMember = {
  userId: string;
  displayName?: string;
  zaloName?: string;
};

type ResolveOutboundGroupMentions = (text: string, members: GroupMentionMember[]) => Mention[];
type HasPotentialOutboundGroupMention = (text: string) => boolean;

async function loadModule(): Promise<{
  resolveOutboundGroupMentions: ResolveOutboundGroupMentions;
  hasPotentialOutboundGroupMention?: HasPotentialOutboundGroupMention;
}> {
  const loaded = (await import("./group-mentions.js").catch(() => ({}))) as {
    resolveOutboundGroupMentions?: ResolveOutboundGroupMentions;
    hasPotentialOutboundGroupMention?: HasPotentialOutboundGroupMention;
  };
  assert.equal(typeof loaded.resolveOutboundGroupMentions, "function");
  return {
    resolveOutboundGroupMentions: loaded.resolveOutboundGroupMentions!,
    hasPotentialOutboundGroupMention: loaded.hasPotentialOutboundGroupMention,
  };
}

test("resolves a unique display name mention including the @ span", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(resolveOutboundGroupMentions("hello @Alice", [{ userId: "1", displayName: "Alice" }]), [
    { pos: 6, len: 6, uid: "1" },
  ]);
});

test("resolves mentions against the final plain text after formatting is parsed", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();
  const { text } = parseTextStyles("**@Alice Nguyen** hello");

  assert.equal(text, "@Alice Nguyen hello");
  assert.deepStrictEqual(resolveOutboundGroupMentions(text, [{ userId: "1", displayName: "Alice Nguyen" }]), [
    { pos: 0, len: 13, uid: "1" },
  ]);
});

test("prefers the longest unique member label when names overlap", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(
    resolveOutboundGroupMentions("hi @Ann Nguyen!", [
      { userId: "1", displayName: "Ann" },
      { userId: "2", displayName: "Ann Nguyen" },
    ]),
    [{ pos: 3, len: 11, uid: "2" }],
  );
});

test("can resolve a mention from zaloName when displayName is absent", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(resolveOutboundGroupMentions("ping @alice_123", [{ userId: "1", zaloName: "alice_123" }]), [
    { pos: 5, len: 10, uid: "1" },
  ]);
});

test("can resolve a mention from the member id", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(resolveOutboundGroupMentions("ping @123456789", [{ userId: "123456789", displayName: "Alice" }]), [
    { pos: 5, len: 10, uid: "123456789" },
  ]);
});

test("throws when a mention label matches multiple group members", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.throws(
    () =>
      resolveOutboundGroupMentions("@Alex", [
        { userId: "1", displayName: "Alex" },
        { userId: "2", displayName: "Alex" },
      ]),
    /Ambiguous mention/i,
  );
});

test("does not resolve partial labels inside hyphenated text", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(
    resolveOutboundGroupMentions("deploy @Alice-dev now", [{ userId: "1", displayName: "Alice" }]),
    [],
  );
});

test("does not resolve path-like text as a mention", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(
    resolveOutboundGroupMentions("see /@Alice/notes for details", [{ userId: "1", displayName: "Alice" }]),
    [],
  );
});

test("still resolves a mention followed by sentence punctuation", async () => {
  const { resolveOutboundGroupMentions } = await loadModule();

  assert.deepStrictEqual(resolveOutboundGroupMentions("thanks @Alice.", [{ userId: "1", displayName: "Alice" }]), [
    { pos: 7, len: 6, uid: "1" },
  ]);
});

test("can detect whether text contains a plausible outbound mention marker", async () => {
  const { hasPotentialOutboundGroupMention } = await loadModule();

  assert.equal(typeof hasPotentialOutboundGroupMention, "function");
  assert.equal(hasPotentialOutboundGroupMention!("contact me at name@example.com"), false);
  assert.equal(hasPotentialOutboundGroupMention!("hi @Alice"), true);
  assert.equal(hasPotentialOutboundGroupMention!("see /@Alice/notes"), false);
  assert.equal(hasPotentialOutboundGroupMention!("@"), false);
});
