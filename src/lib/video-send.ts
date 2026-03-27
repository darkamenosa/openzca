import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ThreadType, type API } from "zca-js";
import { getSendRetryConfigFromEnv, retryable } from "./send-retry.js";

const execFileAsync = promisify(execFile);

export type VideoSendModePlan =
  | {
      mode: "native";
    }
  | {
      mode: "attachment";
      reason: string;
    };

export type VideoProbeMetadata = {
  durationMs?: number;
  width?: number;
  height?: number;
};

type GeneratedThumbnail = {
  path: string;
  cleanup: () => Promise<void>;
};

export function planVideoSendMode(params: {
  files: string[];
  ffmpegAvailable: boolean;
}): VideoSendModePlan {
  const { files, ffmpegAvailable } = params;

  if (!ffmpegAvailable) {
    return {
      mode: "attachment",
      reason: "ffmpeg is unavailable for native video mode",
    };
  }

  if (files.length !== 1) {
    return {
      mode: "attachment",
      reason: "native-video mode supports one video at a time",
    };
  }

  const ext = path.extname(files[0] ?? "").toLowerCase();
  if (ext !== ".mp4") {
    return {
      mode: "attachment",
      reason: "native-video mode currently supports .mp4 inputs only",
    };
  }

  return { mode: "native" };
}

export function parseVideoProbeOutput(raw: string): VideoProbeMetadata {
  const parsed = JSON.parse(raw) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const width = toPositiveInteger(videoStream?.width);
  const height = toPositiveInteger(videoStream?.height);
  const durationSeconds = toPositiveNumber(videoStream?.duration) ?? toPositiveNumber(parsed.format?.duration);

  return {
    durationMs: durationSeconds ? Math.round(durationSeconds * 1000) : undefined,
    width,
    height,
  };
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.trunc(numeric);
    }
  }
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return undefined;
}

async function runBinary(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`${command} is required for native video mode`);
    }
    if (error instanceof Error && "stderr" in error) {
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      throw new Error(stderr ? `${command} failed: ${stderr}` : `${command} failed: ${error.message}`);
    }
    throw error;
  }
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    return false;
  }
}

async function maybeProbeVideoFile(filePath: string): Promise<VideoProbeMetadata> {
  try {
    const raw = await runBinary("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    return parseVideoProbeOutput(raw);
  } catch {
    return {};
  }
}

async function generateVideoThumbnail(videoPath: string): Promise<GeneratedThumbnail> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-video-thumb-"));
  const outputPath = path.join(dir, "thumbnail.jpg");

  try {
    await runBinary("ffmpeg", [
      "-y",
      "-ss",
      "1",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ]);
    await fs.access(outputPath);
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }

  return {
    path: outputPath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function pickUploadedVideoUrl(
  uploaded: Awaited<ReturnType<API["uploadAttachment"]>>[number] | undefined,
): string {
  if (!uploaded || !("fileUrl" in uploaded) || typeof uploaded.fileUrl !== "string" || uploaded.fileUrl.length === 0) {
    throw new Error("Video upload did not return a file URL");
  }
  return uploaded.fileUrl;
}

function pickUploadedThumbnailUrl(
  uploaded: Awaited<ReturnType<API["uploadAttachment"]>>[number] | undefined,
): string {
  if (!uploaded || uploaded.fileType !== "image") {
    throw new Error("Thumbnail upload did not return an image result");
  }
  return uploaded.normalUrl || uploaded.hdUrl || uploaded.thumbUrl;
}

export async function sendNativeVideo(params: {
  api: API;
  threadId: string;
  threadType: ThreadType;
  videoPath: string;
  message?: string;
  thumbnailPath?: string;
}): Promise<unknown> {
  const metadata = await maybeProbeVideoFile(params.videoPath);
  const generatedThumbnail = params.thumbnailPath ? null : await generateVideoThumbnail(params.videoPath);
  const thumbnailPath = params.thumbnailPath ?? generatedThumbnail?.path;

  if (!thumbnailPath) {
    throw new Error("Unable to resolve thumbnail path for native video send");
  }

  try {
    const uploadedVideo = await params.api.uploadAttachment([params.videoPath], params.threadId, params.threadType);
    const uploadedThumbnail = await params.api.uploadAttachment([thumbnailPath], params.threadId, params.threadType);
    const sendVideo = retryable(params.api.sendVideo.bind(params.api), getSendRetryConfigFromEnv());

    return await sendVideo(
      {
        msg: params.message ?? "",
        videoUrl: pickUploadedVideoUrl(uploadedVideo[0]),
        thumbnailUrl: pickUploadedThumbnailUrl(uploadedThumbnail[0]),
        duration: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
      },
      params.threadId,
      params.threadType,
    );
  } finally {
    await generatedThumbnail?.cleanup();
  }
}
