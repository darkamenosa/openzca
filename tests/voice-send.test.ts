import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPublishedVoiceUrl,
  getVoicePublishCommandFromEnv,
} from "../src/lib/voice-send.ts";

test("getVoicePublishCommandFromEnv trims configured command", () => {
  assert.equal(
    getVoicePublishCommandFromEnv({
      OPENZCA_VOICE_PUBLISH_CMD: "  /tmp/publish-voice --bucket demo  ",
    }),
    "/tmp/publish-voice --bucket demo",
  );
});

test("getVoicePublishCommandFromEnv returns null when unset", () => {
  assert.equal(getVoicePublishCommandFromEnv({}), null);
});

test("extractPublishedVoiceUrl uses the last non-empty stdout line", () => {
  assert.equal(
    extractPublishedVoiceUrl("uploading...\nhttps://cdn.example.com/voice/demo.m4a\n"),
    "https://cdn.example.com/voice/demo.m4a",
  );
});

test("extractPublishedVoiceUrl rejects empty stdout", () => {
  assert.throws(
    () => extractPublishedVoiceUrl("\n  \n"),
    /did not print a public URL/i,
  );
});

test("extractPublishedVoiceUrl rejects non-http output", () => {
  assert.throws(
    () => extractPublishedVoiceUrl("/tmp/demo.m4a"),
    /invalid URL/i,
  );
});
