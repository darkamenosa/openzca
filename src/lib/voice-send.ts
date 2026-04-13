import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GeneratedVoiceFile = {
  path: string;
  cleanup: () => Promise<void>;
};

function sanitizeOutputBasename(filePath: string): string {
  const parsed = path.parse(filePath);
  const base = parsed.name.trim() || "voice";
  const sanitized = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "voice";
}

async function runBinary(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`${command} is required for voice publish mode`);
    }
    if (error instanceof Error && "stderr" in error) {
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      throw new Error(stderr ? `${command} failed: ${stderr}` : `${command} failed: ${error.message}`);
    }
    throw error;
  }
}

export function getVoicePublishCommandFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.OPENZCA_VOICE_PUBLISH_CMD?.trim();
  return configured && configured.length > 0 ? configured : null;
}

export function extractPublishedVoiceUrl(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.at(-1);
  if (!candidate) {
    throw new Error("Voice publish command did not print a public URL to stdout");
  }

  if (!/^https?:\/\/\S+$/i.test(candidate)) {
    throw new Error(`Voice publish command returned an invalid URL: ${candidate}`);
  }

  return candidate;
}

export async function normalizeVoiceForPublish(inputPath: string): Promise<GeneratedVoiceFile> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-voice-"));
  const outputPath = path.join(dir, `${sanitizeOutputBasename(inputPath)}.m4a`);

  try {
    await runBinary("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
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

export async function publishVoiceFile(command: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "sh",
      ["-c", `${command} "$1"`, "openzca-voice-publish", filePath],
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return extractPublishedVoiceUrl(stdout);
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      throw new Error(
        stderr
          ? `Voice publish command failed: ${stderr}`
          : `Voice publish command failed: ${error.message}`,
      );
    }
    throw error;
  }
}
