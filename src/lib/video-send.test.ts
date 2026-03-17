import assert from "node:assert/strict";
import test from "node:test";

type PlanVideoSendMode = (params: {
  files: string[];
  ffmpegAvailable: boolean;
}) => {
  mode: "native" | "attachment";
  reason?: string;
};

type ParseVideoProbeOutput = (raw: string) => {
  durationMs?: number;
  width?: number;
  height?: number;
};

async function loadVideoSendHelpers(): Promise<{
  planVideoSendMode: PlanVideoSendMode;
  parseVideoProbeOutput: ParseVideoProbeOutput;
}> {
  const loaded = (await import("./video-send.js").catch(() => ({}))) as {
    planVideoSendMode?: PlanVideoSendMode;
    parseVideoProbeOutput?: ParseVideoProbeOutput;
  };

  assert.equal(typeof loaded.planVideoSendMode, "function");
  assert.equal(typeof loaded.parseVideoProbeOutput, "function");

  return {
    planVideoSendMode: loaded.planVideoSendMode!,
    parseVideoProbeOutput: loaded.parseVideoProbeOutput!,
  };
}

test("planVideoSendMode uses native mode for a single mp4 input when ffmpeg is available", async () => {
  const { planVideoSendMode } = await loadVideoSendHelpers();

  assert.deepStrictEqual(
    planVideoSendMode({
      files: ["/tmp/demo.mp4"],
      ffmpegAvailable: true,
    }),
    {
      mode: "native",
    },
  );
});

test("planVideoSendMode falls back when ffmpeg is unavailable", async () => {
  const { planVideoSendMode } = await loadVideoSendHelpers();

  assert.deepStrictEqual(
    planVideoSendMode({
      files: ["/tmp/demo.mp4"],
      ffmpegAvailable: false,
    }),
    {
      mode: "attachment",
      reason: "ffmpeg is unavailable for native video mode",
    },
  );
});

test("planVideoSendMode falls back for multiple files", async () => {
  const { planVideoSendMode } = await loadVideoSendHelpers();

  assert.deepStrictEqual(
    planVideoSendMode({
      files: ["/tmp/one.mp4", "/tmp/two.mp4"],
      ffmpegAvailable: true,
    }),
    {
      mode: "attachment",
      reason: "native-video mode supports one video at a time",
    },
  );
});

test("planVideoSendMode falls back for non-mp4 inputs", async () => {
  const { planVideoSendMode } = await loadVideoSendHelpers();

  assert.deepStrictEqual(
    planVideoSendMode({
      files: ["/tmp/demo.mov"],
      ffmpegAvailable: true,
    }),
    {
      mode: "attachment",
      reason: "native-video mode currently supports .mp4 inputs only",
    },
  );
});

test("parseVideoProbeOutput extracts duration and dimensions from ffprobe json", async () => {
  const { parseVideoProbeOutput } = await loadVideoSendHelpers();

  const metadata = parseVideoProbeOutput(
    JSON.stringify({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          duration: "5.432",
        },
      ],
      format: {
        duration: "5.432",
      },
    }),
  );

  assert.deepStrictEqual(metadata, {
    durationMs: 5432,
    width: 1920,
    height: 1080,
  });
});
