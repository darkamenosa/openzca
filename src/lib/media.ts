import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/aac": ".aac",
  "audio/x-aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12": ".xlsb",
  "application/vnd.ms-excel.sheet.macroenabled.12": ".xlsm",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/json": ".json",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "text/markdown": ".md",
};

export function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function expandLeadingTilde(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function normalizeMediaInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^file:\/\//i.test(trimmed)) {
    try {
      return expandLeadingTilde(fileURLToPath(trimmed));
    } catch {
      return expandLeadingTilde(trimmed.replace(/^file:\/\//i, ""));
    }
  }

  return expandLeadingTilde(trimmed);
}

export function normalizeInputList(values?: string[]): string[] {
  if (!values || values.length === 0) return [];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => normalizeMediaInput(value))
    .filter(Boolean);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
