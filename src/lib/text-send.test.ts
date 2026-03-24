import assert from "node:assert/strict";
import test from "node:test";

import { TextStyle, ThreadType } from "zca-js";

import type { GroupMentionMember } from "./group-mentions.js";

type BuildTextSendPayload = (params: {
  message: string;
  raw?: boolean;
  threadType: ThreadType;
  threadId: string;
  listGroupMembers?: (threadId: string) => Promise<GroupMentionMember[]>;
}) => Promise<unknown>;

type SplitTextSendPayload = (payload: unknown, maxLength?: number) => unknown[];
type PlanTextSendPayloadsForDelivery = (params: {
  payload: unknown;
  threadType: ThreadType;
  threadId: string;
  maxMessageLength?: number;
  maxRequestParamsLengthEstimate?: number;
}) => {
  chunks: unknown[];
  analyses: Array<{
    renderedTextLength: number;
    textPropertiesLength: number;
    requestParamsLengthEstimate: number;
  }>;
};

async function loadBuilder(): Promise<BuildTextSendPayload> {
  const loaded = (await import("./text-send.js").catch(() => ({}))) as {
    buildTextSendPayload?: BuildTextSendPayload;
  };
  assert.equal(typeof loaded.buildTextSendPayload, "function");
  return loaded.buildTextSendPayload!;
}

async function loadSplitter(): Promise<SplitTextSendPayload> {
  const loaded = (await import("./text-send.js").catch(() => ({}))) as {
    splitTextSendPayload?: SplitTextSendPayload;
  };
  assert.equal(typeof loaded.splitTextSendPayload, "function");
  return loaded.splitTextSendPayload!;
}

async function loadDeliveryPlanner(): Promise<PlanTextSendPayloadsForDelivery> {
  const loaded = (await import("./text-send.js").catch(() => ({}))) as {
    planTextSendPayloadsForDelivery?: PlanTextSendPayloadsForDelivery;
  };
  assert.equal(typeof loaded.planTextSendPayloadsForDelivery, "function");
  return loaded.planTextSendPayloadsForDelivery!;
}

test("builds a raw group payload with mentions and calls the member lookup", async () => {
  const buildTextSendPayload = await loadBuilder();
  const lookupCalls: string[] = [];

  const payload = await buildTextSendPayload({
    message: "hi @Alice",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async (threadId) => {
      lookupCalls.push(threadId);
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.deepStrictEqual(lookupCalls, ["group-1"]);
  assert.deepStrictEqual(payload, {
    msg: "hi @Alice",
    mentions: [{ pos: 3, len: 6, uid: "1" }],
  });
});

test("builds a raw group payload resolving a member id mention", async () => {
  const buildTextSendPayload = await loadBuilder();

  const payload = await buildTextSendPayload({
    message: "hi @123456789",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => [{ userId: "123456789", displayName: "Alice" }],
  });

  assert.deepStrictEqual(payload, {
    msg: "hi @123456789",
    mentions: [{ pos: 3, len: 10, uid: "123456789" }],
  });
});

test("builds a formatted group payload with styles and mention offsets from final text", async () => {
  const buildTextSendPayload = await loadBuilder();

  const payload = await buildTextSendPayload({
    message: "**@Alice** hello",
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => [{ userId: "1", displayName: "Alice" }],
  });

  assert.deepStrictEqual(payload, {
    msg: "@Alice hello",
    styles: [{ start: 0, len: 6, st: TextStyle.Bold }],
    mentions: [{ pos: 0, len: 6, uid: "1" }],
  });
});

test("skips group member lookup when there is no plausible mention marker", async () => {
  const buildTextSendPayload = await loadBuilder();
  let lookupCount = 0;

  const payload = await buildTextSendPayload({
    message: "contact me at name@example.com",
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => {
      lookupCount += 1;
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.equal(lookupCount, 0);
  assert.equal(payload, "contact me at name@example.com");
});

test("never performs group mention resolution for direct messages", async () => {
  const buildTextSendPayload = await loadBuilder();
  let lookupCount = 0;

  const payload = await buildTextSendPayload({
    message: "hi @Alice",
    raw: true,
    threadType: ThreadType.User,
    threadId: "user-1",
    listGroupMembers: async () => {
      lookupCount += 1;
      return [{ userId: "1", displayName: "Alice" }];
    },
  });

  assert.equal(lookupCount, 0);
  assert.equal(payload, "hi @Alice");
});

test("splits formatted payloads by rendered text length and preserves styles", async () => {
  const buildTextSendPayload = await loadBuilder();
  const splitTextSendPayload = await loadSplitter();

  const payload = await buildTextSendPayload({
    message: `**${"a".repeat(2001)}**`,
    threadType: ThreadType.User,
    threadId: "user-1",
  });

  const chunks = splitTextSendPayload(payload, 2000);

  assert.deepStrictEqual(chunks, [
    {
      msg: "a".repeat(2000),
      styles: [{ start: 0, len: 2000, st: TextStyle.Bold }],
    },
    {
      msg: "a",
      styles: [{ start: 0, len: 1, st: TextStyle.Bold }],
    },
  ]);
});

test("splits group mention payloads without cutting through a mention span", async () => {
  const buildTextSendPayload = await loadBuilder();
  const splitTextSendPayload = await loadSplitter();

  const payload = await buildTextSendPayload({
    message: `${"a".repeat(1998)} @Alice tail`,
    raw: true,
    threadType: ThreadType.Group,
    threadId: "group-1",
    listGroupMembers: async () => [{ userId: "1", displayName: "Alice" }],
  });

  const chunks = splitTextSendPayload(payload, 2000);

  assert.deepStrictEqual(chunks, [
    `${"a".repeat(1998)} `,
    {
      msg: "@Alice tail",
      mentions: [{ pos: 0, len: 6, uid: "1" }],
    },
  ]);
});

test("delivery planner splits style-heavy payloads even when rendered text is under 2000", async () => {
  const buildTextSendPayload = await loadBuilder();
  const planTextSendPayloadsForDelivery = await loadDeliveryPlanner();

  const message = `Here’s what I currently have available:

- openzca
- apple-notes
- apple-reminders
- clawhub
- coding-agent
- gh-issues
- github
- gog
- healthcheck
- imsg
- mcporter
- model-usage
- node-connect
- openai-whisper
- oracle
- peekaboo
- session-logs
- skill-creator
- summarize
- tmux
- video-frames
- weather
- algorithmic-art
- apify-ultimate-scraper
- aspnet-core
- brand-guidelines
- canvas-design
- chatgpt-apps
- cloudflare-deploy
- contextqmd-docs
- develop-web-game
- doc
- documentation-lookup
- docx
- figma
- figma-implement-design
- find-skills
- frontend-design
- gemini-imagegen
- gh-address-comments
- gh-fix-ci
- imagegen
- jupyter-notebook
- linear
- mcp-builder
- netlify-deploy
- notion-knowledge-capture
- notion-meeting-intelligence
- notion-research-documentation
- notion-spec-to-implementation
- openai-docs
- pdf
- pptx
- render-deploy
- screenshot
- security-best-practices
- security-ownership-map
- security-threat-model
- sentry
- skills-manager
- slack-gif-creator
- slides
- sora
- speech
- spreadsheet
- theme-factory
- transcribe
- vercel-deploy
- webapp-testing
- winui-app
- xlsx
- yeet

If you want, I can also group them by category or explain what any specific one does.`;

  const payload = await buildTextSendPayload({
    message,
    threadType: ThreadType.User,
    threadId: "user-1",
  });

  const plan = planTextSendPayloadsForDelivery({
    payload,
    threadType: ThreadType.User,
    threadId: "user-1",
    maxMessageLength: 2000,
    maxRequestParamsLengthEstimate: 4000,
  });

  assert.ok(plan.chunks.length >= 2);
  assert.equal(plan.analyses.length, plan.chunks.length);
  for (const analysis of plan.analyses) {
    assert.ok(analysis.renderedTextLength <= 2000);
    assert.ok(analysis.requestParamsLengthEstimate <= 4000);
  }
});
