import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
};

export function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function normalizeInputList(values?: string[]): string[] {
  if (!values || values.length === 0) return [];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function inferExt(url: string, contentType: string | null): string {
  if (contentType) {
    const normalized = contentType.split(";")[0].trim().toLowerCase();
    if (CONTENT_TYPE_EXT[normalized]) {
      return CONTENT_TYPE_EXT[normalized];
    }
  }

  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext) return ext;
  } catch {
    // ignore
  }

  return ".bin";
}

export async function downloadUrlsToTempFiles(
  urls: string[],
): Promise<{ files: string[]; cleanup: () => Promise<void> }> {
  if (urls.length === 0) {
    return {
      files: [],
      cleanup: async () => Promise.resolve(),
    };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-"));
  const files: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download URL: ${url} (${response.status})`);
    }

    const ext = inferExt(url, response.headers.get("content-type"));
    const filePath = path.join(dir, `url-${i + 1}${ext}`);
    const data = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, data);
    files.push(filePath);
  }

  return {
    files,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function assertFilesExist(files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await fs.access(file);
    } catch {
      throw new Error(`File not found: ${file}`);
    }
  }
}
