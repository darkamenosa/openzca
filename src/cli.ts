#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");
import util from "node:util";
import { Command } from "commander";
import {
  DestType,
  Gender,
  Reactions,
  ReviewPendingMemberRequestStatus,
  ThreadType,
  type API,
  type Credentials,
} from "zca-js";
import {
  APP_HOME,
  PROFILES_FILE,
  addProfile,
  clearCache,
  clearCredentials,
  ensureProfile,
  getCredentialsPath,
  getProfileDir,
  listProfiles,
  loadCredentials,
  readCache,
  removeProfile,
  resolveProfileName,
  setDefaultProfile,
  setProfileLabel,
  writeCache,
} from "./lib/store.js";
import {
  closeDb,
  disableDb,
  enableDb,
  enqueueDbWrite,
  findFriends,
  getFriendInfo,
  getDbConfigPath,
  getDbStatus,
  getMessageById,
  getSelfProfile,
  getThreadInfo,
  isDbEnabled,
  listChats,
  listFriends,
  listGroups,
  listMessages,
  listRecentMessages,
  listSyncState,
  listThreadMembers,
  normalizeInboundListenRecord,
  persistFriend,
  persistMessage,
  persistSelfProfile,
  persistThread,
  readDbConfig,
  replaceThreadMembers,
  resolveDbPath,
  resolveScopeThreadId,
  setSyncState,
  type DbMedia,
  type DbMention,
  type DbThreadType,
} from "./lib/db.js";
import {
  createZaloClient,
  loginWithCredentialPayload,
  loginWithQrAndPersist,
  loginWithStoredCredentials,
  toCredentials,
} from "./lib/client.js";
import {
  assertFilesExist,
  collectValues,
  downloadUrlsToTempFiles,
  isHttpUrl,
  normalizeMediaInput,
  normalizeInputList,
} from "./lib/media.js";
import {
  buildCreatePollOptions,
  parsePollId,
  parsePollOptionIds,
} from "./lib/group-poll.js";
import { parseDurationInput, parseTimeBoundaryInput } from "./lib/time-range.js";
import {
  type GroupMentionMember,
} from "./lib/group-mentions.js";
import { buildTextSendPayload } from "./lib/text-send.js";
import { isFfmpegAvailable, planVideoSendMode, sendNativeVideo } from "./lib/video-send.js";

const program = new Command();

const EMOJI_REACTION_MAP: Record<string, Reactions> = {
  "❤️": Reactions.HEART,
  "❤": Reactions.HEART,
  "👍": Reactions.LIKE,
  "😆": Reactions.HAHA,
  "😂": Reactions.HAHA,
  "😮": Reactions.WOW,
  "😭": Reactions.CRY,
  "😡": Reactions.ANGRY,
};

type DebugOptions = {
  debug?: boolean;
  debugFile?: string;
  profile?: string;
};

const DEBUG_COMMAND_START = new WeakMap<Command, number>();

function parseDebugFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getActionCommand(args: unknown[]): Command | undefined {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const item = args[index];
    if (item instanceof Command) {
      return item;
    }
  }
  return undefined;
}

function commandPathLabel(command?: Command): string | undefined {
  if (!command) return undefined;
  const names: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name) {
      names.unshift(name);
    }
    current = current.parent ?? null;
  }
  return names.join(" ");
}

function readCliFlag(names: string[]): boolean {
  const argv = process.argv.slice(2);
  return argv.some((item) => names.includes(item));
}

function readCliOptionValue(names: string[]): string | undefined {
  const argv = process.argv.slice(2);
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const item = argv[index];
    for (const name of names) {
      if (item === name) {
        return argv[index + 1];
      }
      if (item.startsWith(`${name}=`)) {
        return item.slice(name.length + 1);
      }
    }
  }
  return undefined;
}

function getDebugOptions(command?: Command): DebugOptions {
  if (command) {
    if (typeof command.optsWithGlobals === "function") {
      return command.optsWithGlobals() as DebugOptions;
    }
    return command.opts() as DebugOptions;
  }
  if (typeof program.optsWithGlobals === "function") {
    return program.optsWithGlobals() as DebugOptions;
  }
  return program.opts() as DebugOptions;
}

function resolveDebugEnabled(command?: Command): boolean {
  if (parseDebugFlag(process.env.OPENZCA_DEBUG)) {
    return true;
  }
  return Boolean(getDebugOptions(command).debug);
}

function resolveDebugFilePath(command?: Command): string {
  const options = getDebugOptions(command);
  const configured =
    options.debugFile?.trim() ||
    process.env.OPENZCA_DEBUG_FILE?.trim() ||
    path.join(APP_HOME, "logs", "openzca-debug.log");
  const normalized = normalizeMediaInput(configured);
  return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized);
}

function writeDebugLine(
  event: string,
  details?: Record<string, unknown>,
  command?: Command,
): void {
  if (!resolveDebugEnabled(command)) {
    return;
  }
  const payload = details ? JSON.stringify(details) : "";
  const line = `${new Date().toISOString()} ${event}${payload ? ` ${payload}` : ""}\n`;
  const filePath = resolveDebugFilePath(command);
  try {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    fsSync.appendFileSync(filePath, line, "utf8");
  } catch {
    // Best effort debug logging; never fail command execution.
  }
}

function wrapAction<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    const command = getActionCommand(args);
    try {
      await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeDebugLine(
        "command.error",
        {
          command: commandPathLabel(command),
          message,
          stack: error instanceof Error ? error.stack : undefined,
        },
        command,
      );
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  };
}

function output(value: unknown, asJson = false): void {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log("(empty)");
      return;
    }

    const head = value[0];
    if (head && typeof head === "object" && !Array.isArray(head)) {
      console.table(value as Record<string, unknown>[]);
      return;
    }
  }

  if (value && typeof value === "object") {
    console.log(util.inspect(value, { colors: false, depth: 6 }));
    return;
  }

  console.log(String(value));
}

function asThreadType(groupFlag?: boolean): ThreadType {
  return groupFlag ? ThreadType.Group : ThreadType.User;
}

function parseBooleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function normalizeCachedId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
}

function collectIdsFromCacheEntries(entries: unknown[], keys: string[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    for (const key of keys) {
      const normalized = normalizeCachedId(row[key]);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }
  return ids;
}

type ListenerOwnerRecord = {
  pid: number;
  profile: string;
  sessionId?: string;
  startedAt: string;
};

type ListenerOwnerLockHandle = {
  lockPath: string;
  release: () => Promise<void>;
};

type ListenerIpcServerHandle = {
  socketPath: string;
  close: () => Promise<void>;
};

type UploadIpcRequest = {
  kind: "upload";
  requestId: string;
  profile: string;
  threadId: string;
  threadType: "group" | "user";
  attachments: string[];
  uploadTimeoutMs?: number;
};

type UploadIpcResponse =
  | {
      kind: "upload_result";
      requestId: string;
      ok: true;
      response: unknown;
    }
  | {
      kind: "upload_result";
      requestId: string;
      ok: false;
      error: string;
    };

type UploadIpcAttemptResult =
  | { handled: true; response: unknown }
  | { handled: false; reason: string };

function getListenerOwnerLockPath(profile: string): string {
  return path.join(getProfileDir(profile), "listener-owner.json");
}

function getListenIpcSocketPath(profile: string): string {
  if (process.platform === "win32") {
    const safe = profile.replace(/[^A-Za-z0-9_-]/g, "_");
    return `\\\\.\\pipe\\openzca-listen-${safe}`;
  }
  return path.join(getProfileDir(profile), "listen.sock");
}

function parsePositiveIntFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

async function readListenerOwnerRecord(lockPath: string): Promise<ListenerOwnerRecord | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ListenerOwnerRecord>;
    const pid = parsePositiveIntFromUnknown(parsed.pid);
    if (!pid) return null;
    return {
      pid,
      profile: String(parsed.profile ?? ""),
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function readActiveListenerOwner(profile: string): Promise<ListenerOwnerRecord | null> {
  const lockPath = getListenerOwnerLockPath(profile);
  const record = await readListenerOwnerRecord(lockPath);
  if (!record) {
    await fs.rm(lockPath, { force: true });
    return null;
  }

  if (!isProcessAlive(record.pid)) {
    await fs.rm(lockPath, { force: true });
    return null;
  }

  return record;
}

async function acquireListenerOwnerLock(
  profile: string,
  sessionId: string,
  command?: Command,
): Promise<ListenerOwnerLockHandle> {
  await ensureProfile(profile);
  const lockPath = getListenerOwnerLockPath(profile);
  const record: ListenerOwnerRecord = {
    pid: process.pid,
    profile,
    sessionId,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.writeFile(lockPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });

      let released = false;
      return {
        lockPath,
        release: async () => {
          if (released) return;
          released = true;
          const current = await readListenerOwnerRecord(lockPath);
          if (current && current.pid !== process.pid) return;
          await fs.rm(lockPath, { force: true });
          writeDebugLine(
            "listen.owner.released",
            {
              profile,
              lockPath,
              pid: process.pid,
            },
            command,
          );
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const owner = await readActiveListenerOwner(profile);
      if (owner) {
        throw new Error(
          `Another openzca listener already owns profile "${profile}" (pid ${owner.pid}).`,
        );
      }
      await fs.rm(lockPath, { force: true });
    }
  }

  throw new Error(`Unable to acquire listener ownership for profile "${profile}".`);
}

async function startListenerIpcServer(
  api: API,
  profile: string,
  sessionId: string,
  command?: Command,
): Promise<ListenerIpcServerHandle | null> {
  if (!parseBooleanFromEnv("OPENZCA_LISTEN_IPC", true)) {
    writeDebugLine(
      "listen.ipc.disabled",
      {
        profile,
      },
      command,
    );
    return null;
  }

  const socketPath = getListenIpcSocketPath(profile);
  if (process.platform !== "win32") {
    await fs.rm(socketPath, { force: true });
  }

  const uploadTimeoutMs = parsePositiveIntFromEnv(
    "OPENZCA_UPLOAD_IPC_HANDLER_TIMEOUT_MS",
    parsePositiveIntFromEnv("OPENZCA_UPLOAD_TIMEOUT_MS", 120_000),
  );

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let done = false;

    const sendResponse = (response: UploadIpcResponse) => {
      if (done) return;
      done = true;
      socket.end(`${JSON.stringify(response)}\n`);
    };

    const fail = (requestId: string, message: string) => {
      sendResponse({
        kind: "upload_result",
        requestId,
        ok: false,
        error: message,
      });
    };

    const handleRequest = async (line: string) => {
      if (done) return;
      let parsed: UploadIpcRequest;
      try {
        parsed = JSON.parse(line) as UploadIpcRequest;
      } catch {
        fail("", "Invalid JSON request.");
        return;
      }

      if (parsed.kind !== "upload") {
        fail(parsed.requestId || "", "Unsupported IPC request kind.");
        return;
      }
      if (parsed.profile !== profile) {
        fail(parsed.requestId, "Profile mismatch.");
        return;
      }
      if (!parsed.threadId || !Array.isArray(parsed.attachments) || parsed.attachments.length === 0) {
        fail(parsed.requestId, "Invalid upload payload.");
        return;
      }

      const threadType = parsed.threadType === "group" ? ThreadType.Group : ThreadType.User;
      const requestTimeoutMs =
        parsePositiveIntFromUnknown(parsed.uploadTimeoutMs) ?? uploadTimeoutMs;

      writeDebugLine(
        "listen.ipc.upload.start",
        {
          profile,
          sessionId,
          requestId: parsed.requestId,
          threadId: parsed.threadId,
          threadType: parsed.threadType,
          attachmentCount: parsed.attachments.length,
          timeoutMs: requestTimeoutMs,
        },
        command,
      );

      try {
        const response = await withTimeout(
          api.sendMessage(
            {
              msg: "",
              attachments: parsed.attachments,
            },
            parsed.threadId,
            threadType,
          ),
          requestTimeoutMs,
          `Timed out waiting ${requestTimeoutMs}ms for IPC upload completion.`,
        );

        sendResponse({
          kind: "upload_result",
          requestId: parsed.requestId,
          ok: true,
          response,
        });

        writeDebugLine(
          "listen.ipc.upload.done",
          {
            profile,
            sessionId,
            requestId: parsed.requestId,
            threadId: parsed.threadId,
            threadType: parsed.threadType,
          },
          command,
        );
      } catch (error) {
        fail(parsed.requestId, toErrorText(error));
        writeDebugLine(
          "listen.ipc.upload.error",
          {
            profile,
            sessionId,
            requestId: parsed.requestId,
            threadId: parsed.threadId,
            threadType: parsed.threadType,
            message: toErrorText(error),
          },
          command,
        );
      }
    };

    socket.on("data", (chunk) => {
      if (done) return;
      buffer += chunk;
      if (buffer.length > 2_000_000) {
        fail("", "IPC request too large.");
        return;
      }

      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = "";
      if (!line) {
        fail("", "Empty IPC request.");
        return;
      }
      void handleRequest(line);
    });

    socket.on("error", (error) => {
      writeDebugLine(
        "listen.ipc.socket_error",
        {
          profile,
          sessionId,
          message: toErrorText(error),
        },
        command,
      );
    });
  });

  server.on("error", (error) => {
    writeDebugLine(
      "listen.ipc.server_error",
      {
        profile,
        sessionId,
        message: toErrorText(error),
      },
      command,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  writeDebugLine(
    "listen.ipc.started",
    {
      profile,
      sessionId,
      socketPath,
    },
    command,
  );

  let closed = false;
  return {
    socketPath,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      if (process.platform !== "win32") {
        await fs.rm(socketPath, { force: true });
      }
      writeDebugLine(
        "listen.ipc.stopped",
        {
          profile,
          sessionId,
          socketPath,
        },
        command,
      );
    },
  };
}

async function tryUploadViaListenerIpc(
  profile: string,
  threadId: string,
  threadType: ThreadType,
  attachments: string[],
  command?: Command,
): Promise<UploadIpcAttemptResult> {
  if (!parseBooleanFromEnv("OPENZCA_UPLOAD_IPC", true)) {
    return { handled: false, reason: "ipc_disabled" };
  }

  const socketPath = getListenIpcSocketPath(profile);
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  const connectTimeoutMs = parsePositiveIntFromEnv("OPENZCA_UPLOAD_IPC_CONNECT_TIMEOUT_MS", 1_000);
  const requestTimeoutMs = parsePositiveIntFromEnv(
    "OPENZCA_UPLOAD_IPC_TIMEOUT_MS",
    parsePositiveIntFromEnv("OPENZCA_UPLOAD_TIMEOUT_MS", 120_000) + 5_000,
  );

  writeDebugLine(
    "msg.upload.ipc.try",
    {
      profile,
      threadId,
      threadType: threadType === ThreadType.Group ? "group" : "user",
      attachmentCount: attachments.length,
      socketPath,
      requestId,
      connectTimeoutMs,
      requestTimeoutMs,
    },
    command,
  );

  return await new Promise<UploadIpcAttemptResult>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let connected = false;
    let settled = false;
    let responseBuffer = "";
    let requestSent = false;

    const finish = (result?: UploadIpcAttemptResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      if (!socket.destroyed) {
        socket.destroy();
      }

      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? { handled: false, reason: "unknown" });
    };

    const connectTimer = setTimeout(() => {
      finish(undefined, new Error(`Timed out waiting ${connectTimeoutMs}ms to connect upload IPC.`));
    }, connectTimeoutMs);

    const requestTimer = setTimeout(() => {
      finish(undefined, new Error(`Timed out waiting ${requestTimeoutMs}ms for upload IPC response.`));
    }, requestTimeoutMs);

    socket.setEncoding("utf8");

    socket.on("connect", () => {
      connected = true;
      clearTimeout(connectTimer);

      const payload: UploadIpcRequest = {
        kind: "upload",
        requestId,
        profile,
        threadId,
        threadType: threadType === ThreadType.Group ? "group" : "user",
        attachments,
      };
      socket.write(`${JSON.stringify(payload)}\n`);
      requestSent = true;
    });

    socket.on("data", (chunk) => {
      responseBuffer += chunk;
      const newlineIndex = responseBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = responseBuffer.slice(0, newlineIndex).trim();
      if (!line) {
        finish(undefined, new Error("Upload IPC returned empty response."));
        return;
      }

      let parsed: UploadIpcResponse;
      try {
        parsed = JSON.parse(line) as UploadIpcResponse;
      } catch {
        finish(undefined, new Error("Upload IPC returned invalid JSON."));
        return;
      }

      if (parsed.kind !== "upload_result" || parsed.requestId !== requestId) {
        finish(undefined, new Error("Upload IPC returned mismatched response."));
        return;
      }

      if (!parsed.ok) {
        finish(undefined, new Error(parsed.error || "Upload IPC failed."));
        return;
      }

      finish({
        handled: true,
        response: parsed.response,
      });
    });

    socket.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (!connected && !requestSent && (code === "ENOENT" || code === "ECONNREFUSED")) {
        finish({
          handled: false,
          reason: code.toLowerCase(),
        });
        return;
      }
      finish(undefined, error);
    });

    socket.on("close", () => {
      if (settled) return;
      if (!connected && !requestSent) {
        finish({
          handled: false,
          reason: "socket_closed_before_connect",
        });
        return;
      }
      finish(undefined, new Error("Upload IPC connection closed before response."));
    });
  });
}

async function resolveUploadThreadType(
  api: API,
  profile: string,
  threadId: string,
  groupFlag: boolean | undefined,
  command?: Command,
): Promise<{ type: ThreadType; reason: string }> {
  if (groupFlag) {
    return { type: ThreadType.Group, reason: "explicit_group_flag" };
  }

  const autoDetectEnabled = parseBooleanFromEnv("OPENZCA_UPLOAD_AUTO_THREAD_TYPE", false);
  if (!autoDetectEnabled) {
    return { type: ThreadType.User, reason: "auto_detect_disabled" };
  }

  try {
    const cache = await readCache(profile);
    const groupIds = collectIdsFromCacheEntries(cache.groups, ["groupId", "grid", "threadId", "id"]);
    if (groupIds.has(threadId)) {
      return { type: ThreadType.Group, reason: "cache_group_match" };
    }

    const friendIds = collectIdsFromCacheEntries(cache.friends, ["userId", "uid", "id", "threadId"]);
    if (friendIds.has(threadId)) {
      return { type: ThreadType.User, reason: "cache_friend_match" };
    }
  } catch (error) {
    writeDebugLine(
      "msg.upload.thread_type.cache_error",
      {
        profile,
        threadId,
        message: toErrorText(error),
      },
      command,
    );
  }

  const probeEnabled = parseBooleanFromEnv("OPENZCA_UPLOAD_GROUP_PROBE", true);
  if (!probeEnabled) {
    return { type: ThreadType.User, reason: "probe_disabled" };
  }

  const probeTimeoutMs = parsePositiveIntFromEnv("OPENZCA_UPLOAD_GROUP_PROBE_TIMEOUT_MS", 5_000);
  try {
    const groupInfo = (await withTimeout(
      api.getGroupInfo(threadId),
      probeTimeoutMs,
      `Timed out waiting ${probeTimeoutMs}ms while probing group thread type.`,
    )) as { gridInfoMap?: Record<string, unknown> };

    if (groupInfo?.gridInfoMap?.[threadId]) {
      return { type: ThreadType.Group, reason: "probe_group_match" };
    }
  } catch (error) {
    writeDebugLine(
      "msg.upload.thread_type.probe_error",
      {
        profile,
        threadId,
        message: toErrorText(error),
      },
      command,
    );
  }

  return { type: ThreadType.User, reason: "default_user" };
}

function parseReaction(input: string): Reactions {
  const normalized = input.trim();

  if (EMOJI_REACTION_MAP[normalized]) {
    return EMOJI_REACTION_MAP[normalized];
  }

  const enumValue = (Reactions as Record<string, string>)[
    normalized.toUpperCase().replace(/[\s-]/g, "_")
  ];
  if (enumValue) {
    return enumValue as Reactions;
  }

  const values = new Set<string>(Object.values(Reactions));
  if (values.has(normalized)) {
    return normalized as Reactions;
  }

  throw new Error(
    `Unsupported reaction \"${input}\". Use emoji (e.g. ❤️) or one of Reactions enum values.`,
  );
}

function formatDateOnly(input: Date): string {
  const y = input.getUTCFullYear();
  const m = String(input.getUTCMonth() + 1).padStart(2, "0");
  const d = String(input.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeAccountInfo(rawValue: unknown): {
  raw: unknown;
  profile: Record<string, unknown>;
  userId: string;
  displayName: string;
} {
  const raw = rawValue as Record<string, unknown> | null | undefined;
  const profileCandidate =
    raw && typeof raw === "object" && raw.profile && typeof raw.profile === "object"
      ? (raw.profile as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);

  const userId =
    String(
      profileCandidate.userId ??
        profileCandidate.uid ??
        profileCandidate.userKey ??
        profileCandidate.id ??
        "",
    ) || "";
  const displayName =
    String(
      profileCandidate.displayName ??
        profileCandidate.zaloName ??
        profileCandidate.username ??
        profileCandidate.name ??
        "",
    ) || "";

  return {
    raw: rawValue,
    profile: profileCandidate,
    userId,
    displayName,
  };
}

function normalizeMeInfoOutput(rawValue: unknown): Record<string, unknown> {
  const info = normalizeAccountInfo(rawValue);
  const avatar = getStringCandidate(info.profile, [
    "avatar",
    "avatarUrl",
    "avatar_url",
    "thumbSrc",
    "thumb",
  ]);

  return {
    ...info.profile,
    userId: info.userId || undefined,
    displayName: info.displayName || undefined,
    avatar: avatar || undefined,
  };
}

async function currentProfile(_command?: Command): Promise<string> {
  const opts = program.opts() as { profile?: string };
  return resolveProfileName(opts.profile);
}

async function profileForLogin(): Promise<string> {
  const opts = program.opts() as { profile?: string };
  const explicit = opts.profile?.trim();
  const fromEnv = process.env.OPENZCA_PROFILE?.trim() || process.env.ZCA_PROFILE?.trim();

  if (explicit) {
    await ensureProfile(explicit);
    return explicit;
  }

  if (fromEnv) {
    await ensureProfile(fromEnv);
    return fromEnv;
  }

  const db = await listProfiles();
  const fallback = db.defaultProfile || "default";
  await ensureProfile(fallback);
  return fallback;
}

async function requireApi(command?: Command): Promise<{ profile: string; api: API }> {
  const profile = await currentProfile(command);
  const api = await loginWithStoredCredentials(profile);
  return { profile, api };
}

function toDbThreadType(groupFlag?: boolean): DbThreadType {
  return groupFlag ? "group" : "user";
}

function getDbWriteOverride(opts: { db?: boolean } | undefined): boolean | undefined {
  if (!opts || typeof opts.db !== "boolean") {
    return undefined;
  }
  return opts.db;
}

async function shouldWriteToDb(profile: string, override?: boolean): Promise<boolean> {
  if (typeof override === "boolean") {
    return override;
  }
  return isDbEnabled(profile);
}

function scheduleDbWrite(
  profile: string,
  command: Command | undefined,
  event: string,
  task: () => Promise<void>,
): void {
  enqueueDbWrite(profile, async () => {
    try {
      await task();
    } catch (error) {
      writeDebugLine(
        event,
        {
          profile,
          message: error instanceof Error ? error.message : String(error),
        },
        command,
      );
    }
  });
}

function extractResponseMessageIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (!item) return;
    if (Array.isArray(item)) {
      for (const nested of item) {
        visit(nested);
      }
      return;
    }
    if (typeof item !== "object") {
      return;
    }
    const record = item as Record<string, unknown>;
    const msgId = normalizeCachedId(record.msgId);
    if (msgId) {
      ids.add(msgId);
    }
    for (const key of ["message", "attachment", "attachments", "results", "response"]) {
      if (key in record) {
        visit(record[key]);
      }
    }
  };
  visit(value);
  return Array.from(ids);
}

async function persistOutgoingMessageBestEffort(params: {
  profile: string;
  api: API;
  threadId: string;
  group?: boolean;
  text?: string;
  msgType?: string;
  response: unknown;
  rawPayload?: unknown;
  media?: DbMedia[];
}): Promise<void> {
  const selfId = params.api.getOwnId();
  const threadType = toDbThreadType(params.group);
  const scopeThreadId = resolveScopeThreadId({
    threadType,
    rawThreadId: params.threadId,
    senderId: selfId,
    toId: params.threadId,
    selfId,
  });
  const messageIds = extractResponseMessageIds(params.response);
  const baseRecord = {
    profile: params.profile,
    scopeThreadId,
    rawThreadId: params.threadId,
    threadType,
    peerId: threadType === "user" ? scopeThreadId : undefined,
    senderId: selfId,
    senderName: undefined,
    toId: threadType === "user" ? params.threadId : undefined,
    timestampMs: Date.now(),
    msgType: params.msgType,
    contentText: params.text,
    media: params.media,
    source: "send",
    rawPayloadJson: params.rawPayload ? JSON.stringify(params.rawPayload) : undefined,
    rawMessageJson: JSON.stringify(params.response),
  };

  if (messageIds.length === 0) {
    await persistMessage(baseRecord);
    return;
  }

  for (const msgId of messageIds) {
    await persistMessage({
      ...baseRecord,
      msgId,
    });
  }
}

async function persistGroupMembersSnapshot(
  profile: string,
  groupId: string,
  api: API,
): Promise<void> {
  const rows = await listGroupMemberRows(api, groupId);
  const snapshotAtMs = Date.now();
  await replaceThreadMembers(
    profile,
    groupId,
    rows.map((row) => ({
      profile,
      scopeThreadId: groupId,
      userId: row.userId,
      displayName: row.displayName,
      zaloName: row.zaloName,
      rawJson: JSON.stringify(row),
      snapshotAtMs,
    })),
  );
}

async function persistFriendDirectory(profile: string, api: API): Promise<Map<string, string>> {
  const friends = await api.getAllFriends();
  const nameById = new Map<string, string>();

  for (const friend of friends) {
    const record = friend as Record<string, unknown>;
    const userId = normalizeCachedId(record.userId);
    if (!userId) continue;

    const displayName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : undefined;
    const zaloName =
      typeof record.zaloName === "string" && record.zaloName.trim()
        ? record.zaloName.trim()
        : undefined;
    const avatar =
      typeof record.avatar === "string" && record.avatar.trim()
        ? record.avatar.trim()
        : undefined;
    const title = displayName || zaloName || userId;

    await persistFriend({
      profile,
      userId,
      displayName,
      zaloName,
      avatar,
      accountStatus:
        typeof record.accountStatus === "number" && Number.isFinite(record.accountStatus)
          ? Math.trunc(record.accountStatus)
          : undefined,
      rawJson: JSON.stringify(friend),
    });

    await persistThread({
      profile,
      scopeThreadId: userId,
      rawThreadId: userId,
      threadType: "user",
      peerId: userId,
      title,
      rawJson: JSON.stringify(friend),
    });

    nameById.set(userId, title);
  }

  return nameById;
}

function parseSinceDuration(label: string, value?: string): number | undefined {
  const parsed = parseDurationInput(value);
  if (parsed !== undefined) {
    return parsed;
  }
  if (!value || !value.trim()) {
    return undefined;
  }
  throw new Error(
    `${label} must be a relative duration like 30s, 7m, 24h, 7d, or 2w.`,
  );
}

function parseTimeBoundary(label: string, value?: string): number | undefined {
  const parsed = parseTimeBoundaryInput(value);
  if (parsed !== undefined) {
    return parsed;
  }
  if (!value || !value.trim()) {
    return undefined;
  }
  throw new Error(
    `${label} must be an ISO timestamp, a date, or unix seconds/ms.`,
  );
}

function pickExclusiveOption(
  primaryLabel: string,
  primaryValue: string | undefined,
  aliasLabel: string,
  aliasValue: string | undefined,
): string | undefined {
  if (primaryValue?.trim() && aliasValue?.trim()) {
    throw new Error(`Use either ${primaryLabel} or ${aliasLabel}, not both.`);
  }
  return primaryValue?.trim() ? primaryValue : aliasValue?.trim() ? aliasValue : undefined;
}

function resolveMessageTimeRange(opts: {
  since?: string;
  from?: string;
  until?: string;
  to?: string;
}): { sinceMs?: number; untilMs?: number } {
  const sinceValue = opts.since?.trim() ? opts.since : undefined;
  const fromValue = opts.from?.trim() ? opts.from : undefined;
  const untilValue = pickExclusiveOption("--until", opts.until, "--to", opts.to);

  if (sinceValue && fromValue) {
    throw new Error("Use either --since for a rolling window or --from/--to for an explicit range, not both.");
  }

  if (sinceValue && untilValue) {
    throw new Error("Do not combine --since with --to/--until. Use --from/--to for explicit ranges.");
  }

  return {
    sinceMs: sinceValue
      ? parseSinceDuration("--since", sinceValue)
      : parseTimeBoundary("--from", fromValue),
    untilMs: parseTimeBoundary("--to/--until", untilValue),
  };
}

function resolveMessageQueryOptions(opts: {
  since?: string;
  from?: string;
  until?: string;
  to?: string;
  limit?: string;
  all?: boolean;
  oldestFirst?: boolean;
}): { sinceMs?: number; untilMs?: number; limit?: number; newestFirst: boolean } {
  const { sinceMs, untilMs } = resolveMessageTimeRange(opts);
  if (opts.all && opts.limit?.trim()) {
    throw new Error("Use either --all or --limit, not both.");
  }

  const explicitLimit = parsePositiveIntOption("--limit", opts.limit);
  const hasTimeFilter = sinceMs !== undefined || untilMs !== undefined;
  const limit = opts.all ? undefined : explicitLimit ?? (hasTimeFilter ? undefined : 20);
  const newestFirst = !Boolean(opts.oldestFirst);

  return {
    sinceMs,
    untilMs,
    limit,
    newestFirst,
  };
}

async function resolveStoredChatThreadType(
  profile: string,
  chatId: string,
  forceGroup?: boolean,
): Promise<DbThreadType> {
  if (forceGroup) {
    return "group";
  }
  const row = await getThreadInfo({ profile, threadId: chatId });
  return row?.threadType === "group" ? "group" : "user";
}

async function confirmDestructiveAction(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Refusing destructive operation without --yes in non-interactive mode.");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

type SyncProgressReporter = (message: string) => void;

function createSyncProgressReporter(): SyncProgressReporter {
  if (!process.stderr.isTTY) {
    return () => {};
  }
  return (message: string) => {
    process.stderr.write(`[db sync] ${message}\n`);
  };
}

type DbSyncSummary = {
  profile: string;
  dbPath: string;
  windowCount?: number;
  groupsSynced: number;
  groupMessagesImported: number;
  friendsSynced: number;
  chatsSynced: number;
  dmMessagesImported: number;
  syncState: Record<string, unknown>[];
};

function createDbSyncSummary(profile: string, dbPath: string, count?: number): DbSyncSummary {
  return {
    profile,
    dbPath,
    windowCount: count,
    groupsSynced: 0,
    groupMessagesImported: 0,
    friendsSynced: 0,
    chatsSynced: 0,
    dmMessagesImported: 0,
    syncState: [],
  };
}

function resolveSyncWindowCount(value?: string): number {
  return parsePositiveIntOption("--count", value) ?? 200;
}

async function collectConversationIds(api: API): Promise<{
  pinnedIds: Set<string>;
  hiddenIds: Set<string>;
}> {
  let pinnedIds = new Set<string>();
  let hiddenIds = new Set<string>();

  try {
    const pins = await api.getPinConversations();
    pinnedIds = new Set((pins.conversations ?? []).map((value) => String(value)));
  } catch {
    // Best effort metadata.
  }

  try {
    const hidden = await api.getHiddenConversations();
    hiddenIds = new Set((hidden.threads ?? []).map((item) => String(item.thread_id)));
  } catch {
    // Best effort metadata.
  }

  return { pinnedIds, hiddenIds };
}

async function prepareDbGroupTarget(params: {
  profile: string;
  api: API;
  groupId: string;
  title?: string;
  rawJson?: string;
  pinnedIds: Set<string>;
  hiddenIds: Set<string>;
}): Promise<void> {
  await persistThread({
    profile: params.profile,
    scopeThreadId: params.groupId,
    rawThreadId: params.groupId,
    threadType: "group",
    title: params.title,
    isPinned: params.pinnedIds.has(params.groupId),
    isHidden: params.hiddenIds.has(params.groupId),
    rawJson: params.rawJson,
  });
  await persistGroupMembersSnapshot(params.profile, params.groupId, params.api);
}

async function syncDbGroupHistoryFull(params: {
  profile: string;
  api: API;
  selfId: string;
  targetGroupIds: Set<string>;
  titleById: Map<string, string | undefined>;
  summary: DbSyncSummary;
  progress?: SyncProgressReporter;
}): Promise<void> {
  if (params.targetGroupIds.size === 0) {
    return;
  }

  const getStoredGroupMessageCount = async (): Promise<number> => {
    let total = 0;
    for (const groupId of params.targetGroupIds) {
      const row = await getThreadInfo({
        profile: params.profile,
        threadId: groupId,
        threadType: "group",
      });
      const count =
        row && typeof row.messageCount === "number" && Number.isFinite(row.messageCount)
          ? row.messageCount
          : 0;
      total += count;
    }
    return total;
  };

  const persistMessages = async (messages: RecentThreadMessage[]) => {
    for (const message of messages) {
      if (!params.targetGroupIds.has(message.threadId)) {
        continue;
      }
      processed += 1;
      await persistMessage(
        toDbRecordFromRecentMessage({
          profile: params.profile,
          message,
          source: "sync_group",
          selfId: params.selfId,
          title: params.titleById.get(message.threadId),
        }),
      );
    }
  };

  const beforeCount = await getStoredGroupMessageCount();
  let processed = 0;
  let completeness = "complete";
  let stopReason = "exhausted";
  let pagesRequested = 0;
  let listenerImportedCount = 0;

  try {
    params.progress?.(`syncing full history for ${params.targetGroupIds.size} group(s)`);
    const result = await crawlGroupHistoryViaListener(params.api, {
      maxPages: Number.MAX_SAFE_INTEGER,
      idleTimeoutMs: 15_000,
      onMessages: persistMessages,
      onPage: ({ pagesRequested, filteredCount }) => {
        params.progress?.(
          `groups page ${pagesRequested}: batch ${filteredCount}, processed ${processed}`,
        );
      },
    });
    completeness =
      result.stopReason === "exhausted"
        ? "complete"
        : result.stopReason === "max_pages" || result.stopReason === "timeout"
          ? "partial"
          : "window";
    stopReason = result.stopReason;
    pagesRequested = result.pagesRequested;
    listenerImportedCount = (await getStoredGroupMessageCount()) - beforeCount;
  } catch (error) {
    stopReason = `fallback_window:${toErrorText(error)}`;
    completeness = "window";
  }

  const fallbackCount = 200;
  params.progress?.(`merging recent group API window (${fallbackCount} per group)`);
  const beforeApiCount = await getStoredGroupMessageCount();
  for (const groupId of params.targetGroupIds) {
    const messages = await fetchRecentGroupMessagesViaApi(params.api, groupId, fallbackCount);
    await persistMessages(messages);
    params.progress?.(`group ${groupId}: fetched ${messages.length} message(s) from group history API`);
  }
  const afterCount = await getStoredGroupMessageCount();
  const apiAddedCount = afterCount - beforeApiCount;
  if (apiAddedCount > 0) {
    completeness = "window";
    if (stopReason === "exhausted" && listenerImportedCount === 0) {
      stopReason = "fallback_window:empty_listener_result";
    } else if (stopReason === "exhausted") {
      stopReason = "window_topoff:listener_incomplete";
    }
  }
  const imported = Math.max(afterCount - beforeCount, 0);

  for (const groupId of params.targetGroupIds) {
    await setSyncState({
      profile: params.profile,
      scopeThreadId: groupId,
      threadType: "group",
      status: "synced",
      completeness,
    });
  }

  params.summary.groupsSynced += params.targetGroupIds.size;
  params.summary.groupMessagesImported += imported;
  params.summary.syncState.push({
    kind: "groups",
    groups: params.targetGroupIds.size,
    imported,
    completeness,
    stopReason,
    pagesRequested,
  });
}

async function syncDbFriendDirectory(params: {
  profile: string;
  api: API;
  summary: DbSyncSummary;
  progress?: SyncProgressReporter;
}): Promise<Map<string, string>> {
  params.progress?.("syncing friend directory");
  const names = await persistFriendDirectory(params.profile, params.api);
  params.summary.friendsSynced += names.size;
  params.progress?.(`friend directory synced: ${names.size} friend(s)`);
  params.summary.syncState.push({
    kind: "friends",
    imported: names.size,
  });
  return names;
}

async function syncDbChatThread(params: {
  profile: string;
  api: API;
  selfId: string;
  threadId: string;
  count: number;
  title?: string;
  pinnedIds: Set<string>;
  hiddenIds: Set<string>;
  summary: DbSyncSummary;
  progress?: SyncProgressReporter;
}): Promise<void> {
  const scopeThreadId = resolveScopeThreadId({
    threadType: "user",
    rawThreadId: params.threadId,
    senderId: params.selfId,
    toId: params.threadId,
    selfId: params.selfId,
  });

  await persistThread({
    profile: params.profile,
    scopeThreadId,
    rawThreadId: params.threadId,
    threadType: "user",
    peerId: scopeThreadId,
    title: params.title,
    isPinned: params.pinnedIds.has(params.threadId) || params.pinnedIds.has(scopeThreadId),
    isHidden: params.hiddenIds.has(params.threadId) || params.hiddenIds.has(scopeThreadId),
  });

  const messages = await fetchRecentUserMessagesViaListener(params.api, params.threadId, params.count);
  for (const message of messages) {
    await persistMessage(
      toDbRecordFromRecentMessage({
        profile: params.profile,
        message,
        source: "sync_dm_best_effort",
        selfId: params.selfId,
        title: params.title,
      }),
    );
  }

  await setSyncState({
    profile: params.profile,
    scopeThreadId,
    threadType: "user",
    status: "synced",
    completeness: "best_effort",
  });

  params.summary.chatsSynced += 1;
  params.summary.dmMessagesImported += messages.length;
  params.progress?.(`chat ${scopeThreadId}: imported ${messages.length} message(s)`);
  params.summary.syncState.push({
    kind: "chat",
    chatId: scopeThreadId,
    rawThreadId: params.threadId,
    imported: messages.length,
    completeness: "best_effort",
  });
}

async function syncDbChatsBestEffort(params: {
  profile: string;
  api: API;
  selfId: string;
  count: number;
  titleById: Map<string, string>;
  pinnedIds: Set<string>;
  hiddenIds: Set<string>;
  summary: DbSyncSummary;
  progress?: SyncProgressReporter;
}): Promise<void> {
  const scanLimit = Math.max(params.count * 10, 500);
  params.progress?.(`scanning recent DM/chat windows (target window ${params.count}, scan limit ${scanLimit})`);
  const messages = await fetchRecentUserMessagesAcrossThreads(params.api, scanLimit);
  const seenScopes = new Set<string>();

  for (const message of messages) {
    const title = params.titleById.get(message.threadId);
    const record = toDbRecordFromRecentMessage({
      profile: params.profile,
      message,
      source: "sync_dm_best_effort",
      selfId: params.selfId,
      title,
    });

    await persistThread({
      profile: params.profile,
      scopeThreadId: record.scopeThreadId,
      rawThreadId: record.rawThreadId,
      threadType: "user",
      peerId: record.scopeThreadId,
      title,
      isPinned:
        params.pinnedIds.has(record.rawThreadId) || params.pinnedIds.has(record.scopeThreadId),
      isHidden:
        params.hiddenIds.has(record.rawThreadId) || params.hiddenIds.has(record.scopeThreadId),
    });
    await persistMessage(record);

    if (!seenScopes.has(record.scopeThreadId)) {
      seenScopes.add(record.scopeThreadId);
      await setSyncState({
        profile: params.profile,
        scopeThreadId: record.scopeThreadId,
        threadType: "user",
        status: "synced",
        completeness: "best_effort",
      });
    }
  }

  params.summary.chatsSynced += seenScopes.size;
  params.summary.dmMessagesImported += messages.length;
  params.progress?.(`chat scan finished: ${messages.length} message(s) across ${seenScopes.size} chat(s)`);
  params.summary.syncState.push({
    kind: "chats",
    imported: messages.length,
    chats: seenScopes.size,
    completeness: "best_effort",
  });
}

async function runDbSync(params: {
  command: Command;
  mode: "all" | "groups" | "friends" | "chats" | "group" | "chat";
  count: number;
  groupId?: string;
  threadId?: string;
  progress?: SyncProgressReporter;
}): Promise<DbSyncSummary> {
  const { profile, api } = await requireApi(params.command);
  const dbPath = await resolveDbPath(profile);
  params.progress?.(`starting sync for profile ${profile}`);
  const summary = createDbSyncSummary(
    profile,
    dbPath,
    params.mode === "all" || params.mode === "chats" || params.mode === "chat" ? params.count : undefined,
  );
  const selfId = api.getOwnId();
  const selfInfo = normalizeMeInfoOutput(await api.fetchAccountInfo());
  await persistSelfProfile({
    profile,
    userId: selfId,
    displayName:
      typeof selfInfo.displayName === "string" && selfInfo.displayName.trim()
        ? selfInfo.displayName.trim()
        : undefined,
    infoJson: JSON.stringify(selfInfo),
  });
  const { pinnedIds, hiddenIds } = await collectConversationIds(api);

  let friendNames = new Map<string, string>();

  if (params.mode === "all" || params.mode === "friends" || params.mode === "chats") {
    friendNames = await syncDbFriendDirectory({
      profile,
      api,
      summary,
      progress: params.progress,
    });
  }

  if (params.mode === "all" || params.mode === "groups") {
    const groups = await buildGroupsDetailed(api);
    const targetGroupIds = new Set<string>();
    const titleById = new Map<string, string | undefined>();
    for (const group of groups) {
      const record = group as Record<string, unknown>;
      const groupId = normalizeCachedId(record.groupId);
      if (!groupId) continue;
      const title =
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
        : typeof record.groupName === "string" && record.groupName.trim()
            ? record.groupName.trim()
            : undefined;
      targetGroupIds.add(groupId);
      titleById.set(groupId, title);
      await prepareDbGroupTarget({
        profile,
        api,
        groupId,
        title,
        rawJson: JSON.stringify(group),
        pinnedIds,
        hiddenIds,
      });
    }
    await syncDbGroupHistoryFull({
      profile,
      api,
      selfId,
      targetGroupIds,
      titleById,
      summary,
      progress: params.progress,
    });
  }

  if (params.mode === "group") {
    if (!params.groupId) {
      throw new Error("Missing group id for db sync group.");
    }
    const groupInfo = await api.getGroupInfo(params.groupId);
    const group = groupInfo.gridInfoMap[params.groupId] as Record<string, unknown> | undefined;
    const title =
      typeof group?.name === "string" && group.name.trim()
        ? group.name.trim()
        : undefined;
    await prepareDbGroupTarget({
      profile,
      api,
      groupId: params.groupId,
      title,
      rawJson: group ? JSON.stringify(group) : undefined,
      pinnedIds,
      hiddenIds,
    });
    await syncDbGroupHistoryFull({
      profile,
      api,
      selfId,
      targetGroupIds: new Set([params.groupId]),
      titleById: new Map([[params.groupId, title]]),
      summary,
      progress: params.progress,
    });
  }

  if (params.mode === "chat") {
    if (!params.threadId) {
      throw new Error("Missing chat id for db sync chat.");
    }
    if (friendNames.size === 0) {
      friendNames = await persistFriendDirectory(profile, api);
    }
    await syncDbChatThread({
      profile,
      api,
      selfId,
      threadId: params.threadId,
      count: params.count,
      title: friendNames.get(params.threadId),
      pinnedIds,
      hiddenIds,
      summary,
      progress: params.progress,
    });
  }

  if (params.mode === "all" || params.mode === "chats") {
    if (friendNames.size === 0) {
      friendNames = await persistFriendDirectory(profile, api);
    }
    await syncDbChatsBestEffort({
      profile,
      api,
      selfId,
      count: params.count,
      titleById: friendNames,
      pinnedIds,
      hiddenIds,
      summary,
      progress: params.progress,
    });
  }

  params.progress?.(
    `done: groups=${summary.groupsSynced}, groupMessages=${summary.groupMessagesImported}, friends=${summary.friendsSynced}, chats=${summary.chatsSynced}, dmMessages=${summary.dmMessagesImported}`,
  );

  return summary;
}

async function buildGroupsDetailed(api: API): Promise<any[]> {
  const groups = await api.getAllGroups();
  const ids = Object.keys(groups.gridVerMap ?? {});
  if (ids.length === 0) return [];

  const info = await api.getGroupInfo(ids);
  return ids
    .map((id) => info.gridInfoMap?.[id])
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizeGroupMemberId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/_\d+$/, "");
}

async function listGroupMemberRows(api: API, groupId: string): Promise<GroupMentionMember[]> {
  const info = await api.getGroupInfo(groupId);
  const groupInfo = info.gridInfoMap[groupId];
  if (!groupInfo) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const idsFromMemberIds = Array.isArray(groupInfo.memberIds)
    ? groupInfo.memberIds.map((id) => normalizeGroupMemberId(id)).filter(Boolean)
    : [];
  const memVerList = (groupInfo as { memVerList?: unknown }).memVerList;
  const idsFromMemVerList = Array.isArray(memVerList)
    ? memVerList.map((id) => normalizeGroupMemberId(id)).filter(Boolean)
    : [];

  const currentMems = Array.isArray(groupInfo.currentMems) ? groupInfo.currentMems : [];
  const currentMemberMap = new Map<string, { displayName: string; zaloName: string }>();
  for (const member of currentMems) {
    const userId = normalizeGroupMemberId(member.id);
    if (!userId) continue;
    currentMemberMap.set(userId, {
      displayName: member.dName?.trim() || member.zaloName?.trim() || "",
      zaloName: member.zaloName?.trim() || "",
    });
  }

  const ids = Array.from(
    new Set<string>([
      ...idsFromMemberIds,
      ...idsFromMemVerList,
      ...Array.from(currentMemberMap.keys()),
    ]),
  );

  const profiles = ids.length > 0 ? await api.getGroupMembersInfo(ids) : { profiles: {} };
  const rawProfileMap = profiles.profiles as Record<
    string,
    { id?: string; displayName?: string; zaloName?: string } | undefined
  >;
  const profileMap = new Map<string, { displayName?: string; zaloName?: string }>();
  for (const [key, profile] of Object.entries(rawProfileMap)) {
    if (!profile) continue;
    const normalizedKey = normalizeGroupMemberId(key);
    if (normalizedKey && !profileMap.has(normalizedKey)) {
      profileMap.set(normalizedKey, profile);
    }
    const profileId = normalizeGroupMemberId(profile.id);
    if (profileId && !profileMap.has(profileId)) {
      profileMap.set(profileId, profile);
    }
  }

  return ids.map((id) => ({
    userId: id,
    displayName: profileMap.get(id)?.displayName ?? currentMemberMap.get(id)?.displayName ?? "",
    zaloName: profileMap.get(id)?.zaloName ?? currentMemberMap.get(id)?.zaloName ?? "",
  }));
}

async function listGroupMentionMembers(api: API, threadId: string): Promise<GroupMentionMember[]> {
  return await listGroupMemberRows(api, threadId);
}

async function refreshCacheForProfile(profile: string, api: API): Promise<{ friends: number; groups: number }> {
  const [friends, groups] = await Promise.all([
    api.getAllFriends(),
    buildGroupsDetailed(api),
  ]);

  await writeCache(profile, {
    friends,
    groups,
    updatedAt: new Date().toISOString(),
  });

  return {
    friends: friends.length,
    groups: groups.length,
  };
}

function parsePositiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isListenerAlreadyStarted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /already started/i.test(error.message);
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SHUTDOWN_CALLBACKS = new Set<() => void | Promise<void>>();
let shutdownSignalReceived: NodeJS.Signals | null = null;
let shutdownRunning = false;

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

function registerShutdownCallback(callback: () => void | Promise<void>): () => void {
  SHUTDOWN_CALLBACKS.add(callback);
  return () => {
    SHUTDOWN_CALLBACKS.delete(callback);
  };
}

async function runShutdownCallbacks(signal: NodeJS.Signals): Promise<void> {
  if (shutdownRunning) return;
  shutdownRunning = true;

  const callbacks = Array.from(SHUTDOWN_CALLBACKS);
  SHUTDOWN_CALLBACKS.clear();

  writeDebugLine(
    "process.signal",
    {
      signal,
      callbackCount: callbacks.length,
    },
    undefined,
  );

  for (const callback of callbacks) {
    try {
      await Promise.resolve(callback());
    } catch (error) {
      writeDebugLine(
        "process.signal.callback_error",
        {
          signal,
          message: toErrorText(error),
        },
        undefined,
      );
    }
  }
}

function installSignalHandler(signal: NodeJS.Signals): void {
  process.on(signal, () => {
    if (shutdownSignalReceived) return;
    shutdownSignalReceived = signal;

    const exitCode = signalExitCode(signal);
    const forceExitMs = parsePositiveIntFromEnv("OPENZCA_SIGNAL_FORCE_EXIT_MS", 1_500);
    const forceTimer = setTimeout(() => {
      process.exit(exitCode);
    }, forceExitMs);
    forceTimer.unref();

    void runShutdownCallbacks(signal).finally(() => {
      clearTimeout(forceTimer);
      process.exit(exitCode);
    });
  });
}

installSignalHandler("SIGINT");
installSignalHandler("SIGTERM");

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return await Promise.race([task, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function stopUploadListenerSafely(
  api: API,
  command: Command | undefined,
  waitClosedMs = 1_500,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      api.listener.off("closed", onClosed);
      resolve();
    };

    const onClosed = () => {
      finish();
    };

    api.listener.on("closed", onClosed);
    timeoutId = setTimeout(finish, waitClosedMs);

    try {
      /**
       * zca-js Listener.stop() currently clears cipherKey immediately via reset(),
       * which can race with late websocket frames and trigger decode failures.
       * For upload flow, close the underlying ws directly and let zca-js reset on onclose.
       */
      const internalWs = (api.listener as unknown as { ws?: { close: (code?: number) => void } }).ws;
      if (internalWs && typeof internalWs.close === "function") {
        internalWs.close(1000);
        writeDebugLine("msg.upload.listener.stop.ws_close", undefined, command);
      } else {
        api.listener.stop();
        writeDebugLine("msg.upload.listener.stop", undefined, command);
      }
    } catch {
      finish();
    }
  });
}

async function withUploadListener<T>(
  api: API,
  command: Command | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const connectTimeoutMs = parsePositiveIntFromEnv(
    "OPENZCA_UPLOAD_LISTENER_CONNECT_TIMEOUT_MS",
    8_000,
  );
  const uploadTimeoutMs = parsePositiveIntFromEnv(
    "OPENZCA_UPLOAD_TIMEOUT_MS",
    120_000,
  );

  let startedHere = false;
  const unregisterSignalCleanup = registerShutdownCallback(async () => {
    await stopUploadListenerSafely(api, command);
  });

  const sinkError = (error: unknown) => {
    writeDebugLine(
      "msg.upload.listener.error",
      {
        message: toErrorText(error),
      },
      command,
    );
  };
  const sinkClosed = (code: number, reason: string) => {
    writeDebugLine(
      "msg.upload.listener.closed",
      {
        code,
        reason: reason || undefined,
      },
      command,
    );
  };

  api.listener.on("error", sinkError);
  api.listener.on("closed", sinkClosed);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        api.listener.off("connected", onConnected);
        api.listener.off("error", onConnectError);
        api.listener.off("closed", onConnectClosed);
      };

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      const onConnected = () => {
        writeDebugLine("msg.upload.listener.connected", undefined, command);
        finish();
      };

      const onConnectError = (error: unknown) => {
        finish(new Error(`Upload listener connection error: ${toErrorText(error)}`));
      };

      const onConnectClosed = (code: number, reason: string) => {
        finish(
          new Error(
            `Upload listener closed before ready (code=${code}${reason ? `, reason=${reason}` : ""}).`,
          ),
        );
      };

      timeoutId = setTimeout(() => {
        finish(new Error(`Timed out waiting ${connectTimeoutMs}ms for upload listener connection.`));
      }, connectTimeoutMs);

      api.listener.on("connected", onConnected);
      api.listener.on("error", onConnectError);
      api.listener.on("closed", onConnectClosed);

      try {
        api.listener.start();
        startedHere = true;
        writeDebugLine(
          "msg.upload.listener.start",
          {
            connectTimeoutMs,
            uploadTimeoutMs,
          },
          command,
        );
      } catch (error) {
        if (isListenerAlreadyStarted(error)) {
          writeDebugLine("msg.upload.listener.already_started", undefined, command);
          finish();
          return;
        }
        finish(error);
      }
    });

    return await withTimeout(
      task(),
      uploadTimeoutMs,
      `Timed out waiting ${uploadTimeoutMs}ms for file upload completion.`,
    );
  } finally {
    if (startedHere) {
      await stopUploadListenerSafely(api, command);
    }

    unregisterSignalCleanup();
    api.listener.off("error", sinkError);
    api.listener.off("closed", sinkClosed);
  }
}

type RecentThreadMessageData = {
  actionId?: string;
  msgId: string;
  cliMsgId: string;
  uidFrom: string;
  dName?: string;
  ts: string;
  msgType: string;
  content: unknown;
};

type RecentThreadMessage = {
  threadId: string;
  type: ThreadType;
  data: RecentThreadMessageData;
};

type GroupHistoryCapableApi = API & {
  getGroupChatHistory?: (
    groupId: string,
    count?: number,
  ) => Promise<{ groupMsgs?: RecentThreadMessage[] }>;
};

type GroupHistoryCustomApi = API & {
  __openzcaGroupHistory?: (props: {
    groupId: string;
    count: number;
  }) => Promise<{ groupMsgs?: unknown[] }>;
  custom?: <T, K = any>(
    name: string,
    callback: (args: { utils: any; props: K }) => T | Promise<T>,
  ) => void;
};

function parseRecentMessageTs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate)) {
      return Math.trunc(parsedDate);
    }
  }
  return 0;
}

function sortRecentMessagesNewestFirst(messages: RecentThreadMessage[]): RecentThreadMessage[] {
  return [...messages].sort((left, right) => {
    const rightTs = parseRecentMessageTs(right.data?.ts);
    const leftTs = parseRecentMessageTs(left.data?.ts);
    if (rightTs !== leftTs) return rightTs - leftTs;

    const rightMsgId = String(right.data?.msgId ?? "");
    const leftMsgId = String(left.data?.msgId ?? "");
    if (rightMsgId !== leftMsgId) return rightMsgId.localeCompare(leftMsgId);

    const rightCliMsgId = String(right.data?.cliMsgId ?? "");
    const leftCliMsgId = String(left.data?.cliMsgId ?? "");
    return rightCliMsgId.localeCompare(leftCliMsgId);
  });
}

function getRecentMessageCursor(message: RecentThreadMessage | null): string {
  if (!message) return "";

  const msgId = String(message.data?.msgId ?? "").trim();
  if (msgId) return msgId;

  const actionId = String(message.data?.actionId ?? "").trim();
  if (actionId) return actionId;

  return String(message.data?.cliMsgId ?? "").trim();
}

function getOldestRecentMessage(messages: RecentThreadMessage[]): RecentThreadMessage | null {
  let oldest: RecentThreadMessage | null = null;
  for (const message of messages) {
    if (!oldest) {
      oldest = message;
      continue;
    }
    if (parseRecentMessageTs(message.data?.ts) < parseRecentMessageTs(oldest.data?.ts)) {
      oldest = message;
    }
  }
  return oldest;
}

function getRecentPageCursors(messages: RecentThreadMessage[]): string[] {
  const cursors: string[] = [];
  const seen = new Set<string>();

  const addCursor = (value: string) => {
    const cursor = value.trim();
    if (!cursor || seen.has(cursor)) return;
    seen.add(cursor);
    cursors.push(cursor);
  };

  addCursor(getRecentMessageCursor(getOldestRecentMessage(messages)));
  addCursor(getRecentMessageCursor(messages[messages.length - 1] ?? null));
  addCursor(getRecentMessageCursor(messages[0] ?? null));

  return cursors;
}

type GroupHistoryCrawlResult = {
  messages: RecentThreadMessage[];
  stopReason: "limit" | "exhausted" | "max_pages" | "timeout" | "closed";
  pagesRequested: number;
};

function normalizeGroupHistoryMessages(
  messages: unknown[],
  fallbackThreadId: string,
): RecentThreadMessage[] {
  const normalized: RecentThreadMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const raw = message as Record<string, unknown>;

    if (raw.data && raw.threadId) {
      const wrapped = raw as RecentThreadMessage;
      normalized.push(wrapped);
      continue;
    }

    const threadIdRaw = String(raw.idTo ?? "").trim();
    normalized.push({
      threadId: threadIdRaw || fallbackThreadId,
      type: ThreadType.Group,
      data: {
        actionId:
          typeof raw.actionId === "string" && raw.actionId.trim()
            ? raw.actionId
            : undefined,
        msgId: String(raw.msgId ?? ""),
        cliMsgId: String(raw.cliMsgId ?? ""),
        uidFrom: String(raw.uidFrom ?? ""),
        dName: typeof raw.dName === "string" ? raw.dName : undefined,
        ts: String(raw.ts ?? ""),
        msgType: String(raw.msgType ?? ""),
        content: raw.content ?? "",
      },
    });
  }

  return normalized;
}

async function fetchRecentGroupMessagesViaCustomApi(
  api: API,
  threadId: string,
  count: number,
): Promise<RecentThreadMessage[]> {
  const customApi = api as GroupHistoryCustomApi;
  if (typeof customApi.__openzcaGroupHistory !== "function") {
    if (typeof customApi.custom !== "function") {
      throw new Error("Current zca-js build does not expose API custom hooks.");
    }

    customApi.custom("__openzcaGroupHistory", async ({ utils, props }) => {
      const serviceURL = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/history`);
      const encryptedParams = utils.encodeAES(
        JSON.stringify({
          grid: props.groupId,
          count: props.count,
        }),
      );
      if (!encryptedParams) throw new Error("Failed to encrypt group history params.");
      const response = await utils.request(
        utils.makeURL(serviceURL, { params: encryptedParams }),
        { method: "GET" },
      );
      return await utils.resolve(response, (result: { data?: unknown }) => {
        if (typeof result.data === "string") {
          try {
            return JSON.parse(result.data) as { groupMsgs?: unknown[] };
          } catch {
            return { groupMsgs: [] as unknown[] };
          }
        }
        return (result.data ?? { groupMsgs: [] }) as { groupMsgs?: unknown[] };
      });
    });
  }

  const response = await customApi.__openzcaGroupHistory?.({
    groupId: threadId,
    count,
  });
  const messagesRaw = Array.isArray(response?.groupMsgs) ? response.groupMsgs : [];
  return sortRecentMessagesNewestFirst(
    normalizeGroupHistoryMessages(messagesRaw, threadId),
  ).slice(0, count);
}

async function fetchRecentGroupMessagesViaApi(
  api: API,
  threadId: string,
  count: number,
): Promise<RecentThreadMessage[]> {
  const historyApi = (api as GroupHistoryCapableApi).getGroupChatHistory;
  if (typeof historyApi === "function") {
    try {
      const response = await historyApi(threadId, count);
      const messagesRaw = Array.isArray(response?.groupMsgs) ? response.groupMsgs : [];
      return sortRecentMessagesNewestFirst(
        normalizeGroupHistoryMessages(messagesRaw, threadId),
      ).slice(0, count);
    } catch {
      // Fall back to websocket history path when direct group history API fails.
    }
  }
  try {
    return await fetchRecentGroupMessagesViaCustomApi(api, threadId, count);
  } catch {
    // Fall back to websocket history path when direct group history API fails.
  }
  return fetchRecentGroupMessagesViaListener(api, threadId, count);
}

async function fetchRecentGroupMessagesViaListener(
  api: API,
  threadId: string,
  count: number,
): Promise<RecentThreadMessage[]> {
  const result = await crawlGroupHistoryViaListener(api, {
    threadId,
    limit: count,
    maxPages: parsePositiveIntFromEnv("OPENZCA_RECENT_GROUP_MAX_PAGES", 20),
    idleTimeoutMs: 12_000,
  });
  return result.messages;
}

async function crawlGroupHistoryViaListener(
  api: API,
  options: {
    threadId?: string;
    limit?: number;
    maxPages: number;
    idleTimeoutMs: number;
    onMessages?: (messages: RecentThreadMessage[]) => Promise<void> | void;
    onPage?: (info: { pagesRequested: number; filteredCount: number; collectedCount: number }) => Promise<void> | void;
  },
): Promise<GroupHistoryCrawlResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopReason: GroupHistoryCrawlResult["stopReason"] = "closed";
    const shouldCollect = options.limit != null || !options.onMessages;
    const collected: RecentThreadMessage[] = [];
    const seenMessageKeys = new Set<string>();
    const requestedCursors = new Set<string>();
    let pagesRequested = 0;
    let idleTimer: NodeJS.Timeout | undefined;
    let processing = Promise.resolve();

    const toKey = (message: RecentThreadMessage): string => {
      const msgId = String(message.data?.msgId ?? "");
      const cliMsgId = String(message.data?.cliMsgId ?? "");
      return `${message.threadId}:${msgId}:${cliMsgId}`;
    };

    const requestPage = (lastId: string | null) => {
      const cursor = String(lastId ?? "").trim();
      if (cursor) {
        if (requestedCursors.has(cursor)) return false;
        requestedCursors.add(cursor);
      }
      pagesRequested += 1;
      api.listener.requestOldMessages(ThreadType.Group, cursor || null);
      return true;
    };

    const armIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        finish(undefined, "timeout");
      }, options.idleTimeoutMs);
    };

    const cleanup = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      api.listener.off("connected", onConnected);
      api.listener.off("old_messages", onOldMessages);
      api.listener.off("error", onError);
      api.listener.off("closed", onClosed);

      try {
        api.listener.stop();
      } catch {
        // ignore
      }
    };

    const finish = (error?: unknown, reason?: GroupHistoryCrawlResult["stopReason"]) => {
      if (settled) return;
      settled = true;
      if (reason) {
        stopReason = reason;
      }
      void processing
        .then(() => {
          cleanup();
          if (error) {
            reject(error);
            return;
          }
          resolve({
            messages:
              options.limit != null
                ? sortRecentMessagesNewestFirst(collected).slice(0, options.limit)
                : collected,
            stopReason,
            pagesRequested,
          });
        })
        .catch((processingError) => {
          cleanup();
          reject(processingError);
        });
    };

    const onConnected = () => {
      try {
        armIdleTimer();
        requestPage(null);
      } catch (error) {
        finish(error, "closed");
      }
    };

    const onOldMessages = (messages: unknown[], type: ThreadType) => {
      if (type !== ThreadType.Group) return;
      armIdleTimer();
      const typedMessages = messages as RecentThreadMessage[];

      processing = processing
        .then(async () => {
          const filtered: RecentThreadMessage[] = [];

          for (const message of typedMessages) {
            if (options.threadId && message.threadId !== options.threadId) {
              continue;
            }
            const key = toKey(message);
            if (seenMessageKeys.has(key)) continue;
            seenMessageKeys.add(key);
            if (shouldCollect) {
              collected.push(message);
            }
            filtered.push(message);
          }

          if (filtered.length > 0) {
            await options.onMessages?.(filtered);
          }

          await options.onPage?.({
            pagesRequested,
            filteredCount: filtered.length,
            collectedCount: collected.length,
          });

          if (options.limit != null && collected.length >= options.limit) {
            finish(undefined, "limit");
            return;
          }

          if (typedMessages.length === 0) {
            finish(undefined, "exhausted");
            return;
          }

          if (pagesRequested >= options.maxPages) {
            finish(undefined, "max_pages");
            return;
          }

          const cursorCandidates = getRecentPageCursors(typedMessages);
          let requested = false;
          for (const cursor of cursorCandidates) {
            if (requestPage(cursor)) {
              requested = true;
              break;
            }
          }
          if (!requested) {
            finish(undefined, "exhausted");
          }
        })
        .catch((error) => {
          finish(error, "closed");
        });
    };

    const onError = (error: unknown) => {
      finish(error, "closed");
    };

    const onClosed = () => {
      finish(undefined, "closed");
    };

    api.listener.on("connected", onConnected);
    api.listener.on("old_messages", onOldMessages);
    api.listener.on("error", onError);
    api.listener.on("closed", onClosed);

    try {
      api.listener.start();
    } catch (error) {
      finish(error);
    }
  });
}

async function fetchRecentUserMessagesViaListener(
  api: API,
  threadId: string,
  count: number,
): Promise<RecentThreadMessage[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const collected: RecentThreadMessage[] = [];
    const seenMessageKeys = new Set<string>();
    const requestedCursors = new Set<string>();
    const maxPages = parsePositiveIntFromEnv("OPENZCA_RECENT_USER_MAX_PAGES", 20);
    let pagesRequested = 0;

    const toKey = (message: RecentThreadMessage): string => {
      const msgId = String(message.data?.msgId ?? "");
      const cliMsgId = String(message.data?.cliMsgId ?? "");
      return `${msgId}:${cliMsgId}`;
    };

    const requestPage = (lastId: string | null) => {
      const cursor = String(lastId ?? "").trim();
      if (cursor) {
        if (requestedCursors.has(cursor)) return false;
        requestedCursors.add(cursor);
      }
      pagesRequested += 1;
      api.listener.requestOldMessages(ThreadType.User, cursor || null);
      return true;
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      api.listener.off("connected", onConnected);
      api.listener.off("old_messages", onOldMessages);
      api.listener.off("error", onError);
      api.listener.off("closed", onClosed);

      try {
        api.listener.stop();
      } catch {
        // ignore
      }
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(sortRecentMessagesNewestFirst(collected).slice(0, count));
    };

    const onConnected = () => {
      try {
        requestPage(null);
      } catch (error) {
        finish(error);
      }
    };

    const onOldMessages = (messages: unknown[], type: ThreadType) => {
      if (type !== ThreadType.User) return;

      const typedMessages = messages as RecentThreadMessage[];

      for (const message of typedMessages) {
        if (message.threadId === threadId) {
          const key = toKey(message);
          if (seenMessageKeys.has(key)) continue;
          seenMessageKeys.add(key);
          collected.push(message);
        }
      }

      if (collected.length >= count) {
        finish();
        return;
      }

      if (typedMessages.length === 0) {
        finish();
        return;
      }

      if (pagesRequested >= maxPages) {
        finish();
        return;
      }

      try {
        const cursorCandidates = getRecentPageCursors(typedMessages);
        let requested = false;
        for (const cursor of cursorCandidates) {
          if (requestPage(cursor)) {
            requested = true;
            break;
          }
        }
        if (!requested) finish();
      } catch (error) {
        finish(error);
      }
    };

    const onError = (error: unknown) => {
      finish(error);
    };

    const onClosed = () => {
      finish();
    };

    const timeoutId = setTimeout(() => {
      finish();
    }, 12_000);

    api.listener.on("connected", onConnected);
    api.listener.on("old_messages", onOldMessages);
    api.listener.on("error", onError);
    api.listener.on("closed", onClosed);

    try {
      api.listener.start();
    } catch (error) {
      finish(error);
    }
  });
}

async function fetchRecentUserMessagesAcrossThreads(
  api: API,
  maxMessages: number,
): Promise<RecentThreadMessage[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const collected: RecentThreadMessage[] = [];
    const seenMessageKeys = new Set<string>();
    const requestedCursors = new Set<string>();
    const maxPages = parsePositiveIntFromEnv("OPENZCA_RECENT_USER_MAX_PAGES", 20);
    let pagesRequested = 0;

    const toKey = (message: RecentThreadMessage): string => {
      const msgId = String(message.data?.msgId ?? "");
      const cliMsgId = String(message.data?.cliMsgId ?? "");
      return `${message.threadId}:${msgId}:${cliMsgId}`;
    };

    const requestPage = (lastId: string | null) => {
      const cursor = String(lastId ?? "").trim();
      if (cursor) {
        if (requestedCursors.has(cursor)) return false;
        requestedCursors.add(cursor);
      }
      pagesRequested += 1;
      api.listener.requestOldMessages(ThreadType.User, cursor || null);
      return true;
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      api.listener.off("connected", onConnected);
      api.listener.off("old_messages", onOldMessages);
      api.listener.off("error", onError);
      api.listener.off("closed", onClosed);

      try {
        api.listener.stop();
      } catch {
        // ignore
      }
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(sortRecentMessagesNewestFirst(collected).slice(0, maxMessages));
    };

    const onConnected = () => {
      try {
        requestPage(null);
      } catch (error) {
        finish(error);
      }
    };

    const onOldMessages = (messages: unknown[], type: ThreadType) => {
      if (type !== ThreadType.User) return;
      const typedMessages = messages as RecentThreadMessage[];

      for (const message of typedMessages) {
        const key = toKey(message);
        if (seenMessageKeys.has(key)) continue;
        seenMessageKeys.add(key);
        collected.push(message);
      }

      if (collected.length >= maxMessages || typedMessages.length === 0 || pagesRequested >= maxPages) {
        finish();
        return;
      }

      try {
        const cursorCandidates = getRecentPageCursors(typedMessages);
        let requested = false;
        for (const cursor of cursorCandidates) {
          if (requestPage(cursor)) {
            requested = true;
            break;
          }
        }
        if (!requested) finish();
      } catch (error) {
        finish(error);
      }
    };

    const onError = (error: unknown) => {
      finish(error);
    };

    const onClosed = () => {
      finish();
    };

    const timeoutId = setTimeout(() => {
      finish();
    }, 12_000);

    api.listener.on("connected", onConnected);
    api.listener.on("old_messages", onOldMessages);
    api.listener.on("error", onError);
    api.listener.on("closed", onClosed);

    try {
      api.listener.start();
    } catch (error) {
      finish(error);
    }
  });
}

function normalizeRecentMessageMentions(value: unknown): DbMention[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: DbMention[] = [];
  const parseOptionalMentionInt = (input: unknown): number | undefined => {
    if (typeof input === "number" && Number.isFinite(input)) {
      return Math.trunc(input);
    }
    if (typeof input === "string" && input.trim()) {
      const parsed = Number(input.trim());
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return undefined;
  };
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const uid = normalizeCachedId(record.uid);
    if (!uid) continue;
    rows.push({
      uid,
      pos: parseOptionalMentionInt(record.pos),
      len: parseOptionalMentionInt(record.len),
      type:
        typeof record.type === "number" && Number.isFinite(record.type)
          ? Math.trunc(record.type)
          : typeof record.type === "string" && record.type.trim()
            ? Number.parseInt(record.type.trim(), 10)
            : undefined,
      rawJson: JSON.stringify(record),
    });
  }
  return rows;
}

function toDbRecordFromRecentMessage(params: {
  profile: string;
  message: RecentThreadMessage;
  source: string;
  selfId?: string;
  title?: string;
}): ReturnType<typeof normalizeInboundListenRecord> {
  const content = params.message.data?.content;
  const quote = (params.message.data as {
    quote?: {
      globalMsgId?: string | number;
      cliMsgId?: string | number;
      ownerId?: string | number;
      msg?: string;
    };
  } | undefined)?.quote;
  return normalizeInboundListenRecord({
    profile: params.profile,
    threadType: params.message.type === ThreadType.Group ? "group" : "user",
    rawThreadId: params.message.threadId,
    senderId: params.message.data?.uidFrom,
    senderName: params.message.data?.dName,
    toId: (params.message.data as { idTo?: string } | undefined)?.idTo,
    selfId: params.selfId,
    title: params.title,
    msgId: params.message.data?.msgId,
    cliMsgId: params.message.data?.cliMsgId,
    actionId: params.message.data?.actionId,
    timestampMs: toEpochMs(params.message.data?.ts),
    msgType: params.message.data?.msgType,
    contentText: typeof content === "string" ? content : undefined,
    contentJson:
      content && typeof content === "object" ? JSON.stringify(content) : undefined,
    quoteMsgId: quote?.globalMsgId != null ? String(quote.globalMsgId) : undefined,
    quoteCliMsgId: quote?.cliMsgId != null ? String(quote.cliMsgId) : undefined,
    quoteOwnerId: quote?.ownerId != null ? String(quote.ownerId) : undefined,
    quoteText: typeof quote?.msg === "string" ? quote.msg : undefined,
    mentions: normalizeRecentMessageMentions(
      (params.message.data as { mentions?: unknown } | undefined)?.mentions,
    ),
    rawMessage: params.message.data,
    source: params.source,
  });
}

async function parseCredentialFile(filePath: string): Promise<Credentials> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<Credentials>;

  if (!parsed.imei || !parsed.cookie || !parsed.userAgent) {
    throw new Error("Credential file must include imei, cookie, and userAgent.");
  }

  return {
    imei: parsed.imei,
    cookie: parsed.cookie,
    userAgent: parsed.userAgent,
    language: parsed.language,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFileContent(filePath: string, timeoutMs: number): Promise<Buffer> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const data = await fs.readFile(filePath);
      if (data.length > 0) {
        return data;
      }
    } catch {
      // Wait until file is created.
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for QR image file: ${filePath}`);
}

async function emitQrBase64FromDetachedLogin(profile: string, qrPath?: string): Promise<void> {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new Error("Cannot resolve CLI entrypoint for QR base64 mode.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openzca-qr-"));
  const targetPath = path.resolve(qrPath ?? path.join(tempDir, "qr.png"));

  const child = spawn(
    process.execPath,
    [scriptPath, "--profile", profile, "auth", "login", "--qr-path", targetPath],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OPENZCA_QR_RENDER: "ascii",
        OPENZCA_QR_AUTO_OPEN: "0",
      },
    },
  );
  child.unref();

  const png = await waitForFileContent(targetPath, 20_000);
  console.log(`data:image/png;base64,${png.toString("base64")}`);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getStringCandidate(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

type InboundMediaKind = "image" | "video" | "audio" | "file";

function normalizeMessageType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function looksLikeStructuredJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first === "{" && last === "}") return true;
  if (first === "[" && last === "]") return true;
  return false;
}

function normalizeStructuredContent(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!looksLikeStructuredJsonString(trimmed)) {
      return value;
    }
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeStructuredContent(parsed, depth + 1);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStructuredContent(entry, depth + 1));
  }

  const record = asObject(value);
  if (!record) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    normalized[key] = normalizeStructuredContent(nested, depth + 1);
  }
  return normalized;
}

function detectInboundMediaKind(msgType: unknown, content: unknown): InboundMediaKind | null {
  const normalizedType = normalizeMessageType(msgType);

  if (
    normalizedType.includes("photo") ||
    normalizedType.includes("gif") ||
    normalizedType.includes("sticker")
  ) {
    return "image";
  }
  if (normalizedType.includes("video")) return "video";
  if (normalizedType.includes("voice") || normalizedType.includes("audio")) return "audio";
  if (normalizedType.includes("share.file")) return "file";
  if (normalizedType.includes("link") || normalizedType.includes("location")) return null;

  const record = asObject(content);
  if (!record) return null;

  if (getStringCandidate(record, ["voiceUrl", "m4aUrl", "audioUrl", "voice_url", "m4a_url", "audio_url"])) {
    return "audio";
  }
  if (getStringCandidate(record, ["videoUrl"])) return "video";
  if (
    getStringCandidate(record, [
      "hdUrl",
      "normalUrl",
      "thumbUrl",
      "thumb",
      "rawUrl",
      "oriUrl",
      "imageUrl",
    ])
  ) {
    return "image";
  }
  if (getStringCandidate(record, ["fileUrl", "fileName", "fileId", "href", "url"])) return "file";

  return null;
}

function collectHttpUrls(value: unknown, sink: Set<string>, depth = 0): void {
  if (depth > 5 || sink.size >= 16) return;

  if (typeof value === "string") {
    const escapedNormalized = value.replace(/\\\//g, "/");
    const matches = escapedNormalized.match(/https?:\/\/[^\s"'<>`]+/gi) ?? [];
    for (const match of matches) {
      const cleaned = match.replace(/[)\],.;"'`]+$/g, "").trim();
      if (isHttpUrl(cleaned)) {
        sink.add(cleaned);
      }
      if (sink.size >= 16) {
        return;
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectHttpUrls(item, sink, depth + 1);
      if (sink.size >= 16) return;
    }
    return;
  }

  const record = asObject(value);
  if (!record) return;
  for (const nested of Object.values(record)) {
    collectHttpUrls(nested, sink, depth + 1);
    if (sink.size >= 16) return;
  }
}

function preferredMediaKeys(kind: InboundMediaKind): string[] {
  switch (kind) {
    case "image":
      return [
        "hdUrl",
        "normalUrl",
        "rawUrl",
        "oriUrl",
        "imageUrl",
        "photoUrl",
        "fileUrl",
        "thumbUrl",
        "thumb",
        "href",
        "url",
        "src",
      ];
    case "video":
      return [
        "videoUrl",
        "video_url",
        "mediaUrl",
        "streamUrl",
        "playUrl",
        "fileUrl",
        "rawUrl",
        "href",
        "url",
        "src",
      ];
    case "audio":
      return [
        "voiceUrl",
        "m4aUrl",
        "audioUrl",
        "voice_url",
        "m4a_url",
        "audio_url",
        "mediaUrl",
        "downloadUrl",
        "streamUrl",
        "playUrl",
        "fileUrl",
        "rawUrl",
        "href",
        "url",
        "src",
      ];
    case "file":
      return [
        "fileUrl",
        "downloadUrl",
        "rawUrl",
        "normalUrl",
        "oriUrl",
        "fileLink",
        "href",
        "url",
        "src",
      ];
  }
}

function resolvePreferredMediaUrls(kind: InboundMediaKind, content: unknown): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      ordered.push(url);
    }
  };

  const record = asObject(content);
  if (record) {
    for (const key of preferredMediaKeys(kind)) {
      if (!(key in record)) continue;
      const urls = new Set<string>();
      collectHttpUrls(record[key], urls);
      for (const url of urls) {
        push(url);
      }
    }
  }

  const collected = new Set<string>();
  collectHttpUrls(content, collected);
  for (const url of collected) {
    push(url);
  }
  return ordered;
}

function mediaExtFromTypeOrUrl(
  mediaType: string | null,
  mediaUrl: string,
  kind: InboundMediaKind,
): string {
  const normalizedType = mediaType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const byType: Record<string, string> = {
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
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "text/tab-separated-values": ".tsv",
    "application/json": ".json",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "application/zip": ".zip",
    "application/gzip": ".gz",
    "application/x-tar": ".tar",
    "application/x-7z-compressed": ".7z",
    "application/vnd.rar": ".rar",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel.sheet.binary.macroenabled.12": ".xlsb",
    "application/vnd.ms-excel.sheet.macroenabled.12": ".xlsm",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/rtf": ".rtf",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/vnd.oasis.opendocument.presentation": ".odp",
  };
  const fromType = byType[normalizedType];
  if (fromType) return fromType;

  try {
    const parsedUrl = new URL(mediaUrl);
    const ext = path.extname(parsedUrl.pathname);
    if (ext) return ext;
  } catch {
    // ignore
  }

  if (kind === "video") return ".mp4";
  if (kind === "audio") return ".m4a";
  if (kind === "image") return ".jpg";
  return ".bin";
}

function parseMaxInboundMediaBytes(): number {
  const raw = process.env.OPENZCA_LISTEN_MEDIA_MAX_BYTES?.trim();
  if (!raw) return 20 * 1024 * 1024;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20 * 1024 * 1024;
  return Math.trunc(parsed);
}

function parseMaxInboundMediaFiles(): number {
  const raw = process.env.OPENZCA_LISTEN_MEDIA_MAX_FILES?.trim();
  if (!raw) return 4;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 4;
  return Math.min(Math.max(Math.trunc(parsed), 1), 16);
}

function parseInboundMediaFetchTimeoutMs(): number {
  const raw = process.env.OPENZCA_LISTEN_MEDIA_FETCH_TIMEOUT_MS?.trim();
  if (!raw) return 10_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 10_000;
  return Math.trunc(parsed);
}

function resolveOpenClawMediaDir(): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "media");
}

function resolveInboundMediaDir(profile: string): string {
  const configuredRaw = process.env.OPENZCA_LISTEN_MEDIA_DIR?.trim();
  if (configuredRaw) {
    const configured = normalizeMediaInput(configuredRaw);
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  const legacyRequested = process.env.OPENZCA_LISTEN_MEDIA_LEGACY_DIR?.trim() === "1";
  if (legacyRequested) {
    return path.join(getProfileDir(profile), "inbound-media");
  }
  return path.join(resolveOpenClawMediaDir(), "openzca", profile, "inbound");
}

async function cacheInboundMediaToProfile(
  profile: string,
  mediaUrl: string,
  kind: InboundMediaKind,
): Promise<{ mediaPath: string; mediaType: string | null } | null> {
  const maxBytes = parseMaxInboundMediaBytes();
  const timeoutMs = parseInboundMediaFetchTimeoutMs();
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeoutId =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await fetch(mediaUrl, controller ? { signal: controller.signal } : undefined);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out downloading inbound media: ${mediaUrl} (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
  if (!response.ok) {
    throw new Error(`Failed to download inbound media: ${mediaUrl} (${response.status})`);
  }

  const mediaType = response.headers.get("content-type");
  const contentLengthRaw = response.headers.get("content-length");
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return null;
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0 || data.length > maxBytes) {
    return null;
  }

  const dir = resolveInboundMediaDir(profile);
  await fs.mkdir(dir, { recursive: true });

  const ext = mediaExtFromTypeOrUrl(mediaType, mediaUrl, kind);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const mediaPath = path.join(dir, `${id}${ext}`);
  await fs.writeFile(mediaPath, data);

  return { mediaPath, mediaType };
}

async function cacheRemoteMediaEntries(params: {
  profile: string;
  urls: string[];
  kind: InboundMediaKind;
  command: Command;
  warningLabel: string;
  debugErrorEvent: string;
  debugUrlKey: string;
}): Promise<Array<{ mediaPath?: string; mediaUrl?: string; mediaType?: string }>> {
  if (params.urls.length === 0) return [];

  return Promise.all(
    params.urls.map(async (mediaUrl) => {
      let mediaPath: string | undefined;
      let mediaType: string | null = null;
      try {
        const cached = await cacheInboundMediaToProfile(params.profile, mediaUrl, params.kind);
        if (cached) {
          mediaPath = cached.mediaPath;
          mediaType = cached.mediaType;
        }
      } catch (error) {
        console.error(
          `Warning: failed to cache ${params.warningLabel} (${error instanceof Error ? error.message : String(error)})`,
        );
        writeDebugLine(
          params.debugErrorEvent,
          {
            profile: params.profile,
            [params.debugUrlKey]: mediaUrl,
            message: error instanceof Error ? error.message : String(error),
          },
          params.command,
        );
      }

      return {
        mediaPath,
        mediaUrl,
        mediaType: mediaType ?? undefined,
      };
    }),
  );
}

function summarizeStructuredContent(msgType: unknown, content: unknown): string {
  const normalizedType = normalizeMessageType(msgType);
  const record = asObject(content);

  if (normalizedType.includes("link") && record) {
    const href = getStringCandidate(record, ["href", "url", "src"]);
    if (href) return href;
  }

  if (record) {
    const candidateText = getStringCandidate(record, [
      "msg",
      "message",
      "text",
      "caption",
      "title",
      "description",
      "fileName",
      "name",
      "href",
      "url",
      "src",
    ]);
    if (candidateText) return candidateText;
  }

  return normalizedType ? `<non-text:${normalizedType}>` : "<non-text-message>";
}

function buildMediaAttachedText(params: {
  mediaEntries: Array<{ mediaPath?: string; mediaUrl?: string; mediaType?: string | null }>;
  fallbackKind?: InboundMediaKind | null;
  caption?: string;
}): string {
  const entries = params.mediaEntries
    .map((entry) => ({
      pathOrUrl: entry.mediaPath ?? entry.mediaUrl,
      mediaPath: entry.mediaPath,
      mediaUrl: entry.mediaUrl,
      mediaType: entry.mediaType,
    }))
    .filter((entry) => Boolean(entry.pathOrUrl));
  if (entries.length === 0) {
    return params.caption?.trim() || "";
  }

  const fallbackType =
    params.fallbackKind === "image"
      ? "image/*"
      : params.fallbackKind === "video"
        ? "video/*"
        : params.fallbackKind === "audio"
          ? "audio/*"
          : undefined;
  const multiple = entries.length > 1;
  const lines: string[] = [];
  if (multiple) {
    lines.push(`[media attached: ${entries.length} files]`);
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const type = entry.mediaType?.trim() || fallbackType;
    const typePart = type ? ` (${type})` : "";
    const urlPart = entry.mediaPath && entry.mediaUrl ? ` | ${entry.mediaUrl}` : "";
    const prefix = multiple
      ? `[media attached ${index + 1}/${entries.length}: `
      : "[media attached: ";
    lines.push(`${prefix}${entry.pathOrUrl}${typePart}${urlPart}]`);
  }
  const mediaNote = lines.join("\n");

  if (params.caption?.trim()) {
    return `${mediaNote}\n${params.caption.trim()}`;
  }

  return mediaNote;
}

type QuoteContext = {
  ownerId?: string;
  senderName?: string;
  msg?: string;
  attach?: unknown;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: string;
  mediaTypes?: string[];
  mediaPath?: string;
  mediaPaths?: string[];
  ts?: number;
  cliMsgId?: string;
  globalMsgId?: string;
  cliMsgType?: number;
};

type InboundMention = {
  uid: string;
  pos?: number;
  len?: number;
  type?: number;
  text?: string;
};

function parseToggleDefaultTrue(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return true;
}

function truncatePreview(value: string, maxLength = 220): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function normalizeQuoteContext(value: unknown): QuoteContext | null {
  const normalized = normalizeStructuredContent(value);
  const record = asObject(normalized);
  if (!record) return null;

  const ownerId = getStringCandidate(record, [
    "ownerId",
    "uidFrom",
    "fromId",
    "senderId",
    "uid",
  ]);
  const senderName = getStringCandidate(record, [
    "fromD",
    "senderName",
    "dName",
    "displayName",
    "name",
  ]);
  const msg = getStringCandidate(record, [
    "msg",
    "message",
    "text",
    "content",
    "title",
    "description",
  ]);
  const cliMsgId = getStringCandidate(record, ["cliMsgId"]);
  const globalMsgId = getStringCandidate(record, ["globalMsgId", "msgId", "realMsgId"]);
  const cliMsgType =
    typeof record.cliMsgType === "number" && Number.isFinite(record.cliMsgType)
      ? Math.trunc(record.cliMsgType)
      : undefined;
  const attach =
    record.attach === undefined ? undefined : normalizeStructuredContent(record.attach);
  const mediaUrlSet = new Set<string>();
  if (attach !== undefined) {
    collectHttpUrls(attach, mediaUrlSet);
  }
  const tsRaw = record.ts;
  const tsNumeric =
    typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "string" ? Number(tsRaw) : Number.NaN;
  const ts = Number.isFinite(tsNumeric) ? Math.trunc(tsNumeric) : undefined;

  if (!ownerId && !senderName && !msg && !cliMsgId && !globalMsgId && attach === undefined) {
    return null;
  }

  return {
    ownerId: ownerId || undefined,
    senderName: senderName || undefined,
    msg: msg || undefined,
    attach,
    mediaUrls: mediaUrlSet.size > 0 ? [...mediaUrlSet] : undefined,
    ts,
    cliMsgId: cliMsgId || undefined,
    globalMsgId: globalMsgId || undefined,
    cliMsgType,
  };
}

function buildReplyContextText(quote: QuoteContext): string {
  const from = quote.senderName || quote.ownerId || "unknown";
  const messageText = quote.msg?.trim() || "";
  const attachText =
    quote.attach !== undefined ? summarizeStructuredContent("quote", quote.attach) : "";
  let summary = messageText || attachText;
  if (
    !summary ||
    summary === "<non-text:quote>" ||
    summary === "<non-text-message>"
  ) {
    if (quote.mediaUrls && quote.mediaUrls.length > 0) {
      summary =
        quote.mediaUrls.length > 1
          ? `${quote.mediaUrls[0]} (+${quote.mediaUrls.length - 1} more)`
          : quote.mediaUrls[0];
    } else {
      summary = "<quoted-message>";
    }
  }
  return `[reply context: ${from}: ${truncatePreview(summary.replace(/\s+/g, " "))}]`;
}

function buildReplyMediaAttachedText(params: {
  mediaEntries: Array<{ mediaPath?: string; mediaUrl?: string; mediaType?: string | null }>;
}): string {
  const entries = params.mediaEntries
    .map((entry) => ({
      pathOrUrl: entry.mediaPath ?? entry.mediaUrl,
      mediaPath: entry.mediaPath,
      mediaUrl: entry.mediaUrl,
      mediaType: entry.mediaType,
    }))
    .filter((entry) => Boolean(entry.pathOrUrl));
  if (entries.length === 0) return "";

  const multiple = entries.length > 1;
  const lines: string[] = [];
  if (multiple) {
    lines.push(`[reply media attached: ${entries.length} files]`);
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const typePart = entry.mediaType?.trim() ? ` (${entry.mediaType.trim()})` : "";
    const urlPart = entry.mediaPath && entry.mediaUrl ? ` | ${entry.mediaUrl}` : "";
    const prefix = multiple
      ? `[reply media attached ${index + 1}/${entries.length}: `
      : "[reply media attached: ";
    lines.push(`${prefix}${entry.pathOrUrl}${typePart}${urlPart}]`);
  }

  return lines.join("\n");
}

function parseOptionalInt(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return undefined;
  return Math.trunc(numeric);
}

function buildInboundMention(record: Record<string, unknown>, rawText: string): InboundMention | null {
  const uid = getStringCandidate(record, ["uid", "userId", "user_id", "id"]);
  if (!uid) return null;

  const pos = parseOptionalInt(record.pos ?? record.offset ?? record.start ?? record.index);
  const len = parseOptionalInt(record.len ?? record.length);
  const type = parseOptionalInt(record.type ?? record.kind);
  let text =
    getStringCandidate(record, ["text", "label", "name"]) ||
    (typeof pos === "number" &&
    typeof len === "number" &&
    len > 0 &&
    pos >= 0 &&
    pos < rawText.length
      ? rawText.slice(pos, Math.min(rawText.length, pos + len))
      : "");

  if (!text.trim()) {
    text = "";
  }

  return {
    uid,
    ...(typeof pos === "number" ? { pos } : {}),
    ...(typeof len === "number" ? { len } : {}),
    ...(typeof type === "number" ? { type } : {}),
    ...(text ? { text } : {}),
  };
}

function collectInboundMentions(
  value: unknown,
  sink: Map<string, InboundMention>,
  rawText: string,
  depth = 0,
): void {
  if (depth > 6 || sink.size >= 64 || value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    if (!looksLikeStructuredJsonString(value)) return;
    try {
      const parsed = JSON.parse(value);
      collectInboundMentions(parsed, sink, rawText, depth + 1);
    } catch {
      // ignore invalid JSON content
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const mention = asObject(item) ? buildInboundMention(item as Record<string, unknown>, rawText) : null;
      if (mention) {
        const key = `${mention.uid}|${mention.pos ?? ""}|${mention.len ?? ""}|${mention.type ?? ""}`;
        sink.set(key, mention);
        continue;
      }
      collectInboundMentions(item, sink, rawText, depth + 1);
      if (sink.size >= 64) return;
    }
    return;
  }

  const record = asObject(value);
  if (!record) return;

  const direct = buildInboundMention(record, rawText);
  if (direct) {
    const key = `${direct.uid}|${direct.pos ?? ""}|${direct.len ?? ""}|${direct.type ?? ""}`;
    sink.set(key, direct);
  }

  const mentionKeys = [
    "mentions",
    "mentionInfo",
    "mention_info",
    "mentionList",
    "mention_list",
    "mention",
  ];
  for (const key of mentionKeys) {
    if (!(key in record)) continue;
    collectInboundMentions(record[key], sink, rawText, depth + 1);
    if (sink.size >= 64) return;
  }

  for (const nested of Object.values(record)) {
    collectInboundMentions(nested, sink, rawText, depth + 1);
    if (sink.size >= 64) return;
  }
}

function extractInboundMentions(params: {
  messageData: Record<string, unknown>;
  parsedContent: unknown;
  rawText: string;
}): InboundMention[] {
  const sink = new Map<string, InboundMention>();
  const candidates: unknown[] = [
    params.messageData.mentions,
    params.messageData.mentionInfo,
    params.messageData.mention_info,
    params.messageData.mentionList,
    params.messageData.mention_list,
    params.messageData.mention,
    params.messageData.content,
    params.parsedContent,
  ];
  for (const candidate of candidates) {
    collectInboundMentions(candidate, sink, params.rawText);
    if (sink.size >= 64) break;
  }
  return [...sink.values()];
}

function normalizeFriendLookupRows(value: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [value];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = asObject(current);
    if (!record) {
      continue;
    }

    for (const nestedKey of [
      "data",
      "user",
      "users",
      "items",
      "results",
      "profiles",
      "friends",
      "friend",
      "profile",
      "info",
    ]) {
      if (record[nestedKey] !== undefined && record[nestedKey] !== null) {
        queue.push(record[nestedKey]);
      }
    }

    const userId = getStringCandidate(record, [
      "userId",
      "uid",
      "user_id",
      "userKey",
      "id",
    ]);
    const displayName = getStringCandidate(record, [
      "displayName",
      "zaloName",
      "name",
      "username",
    ]);
    const avatar = getStringCandidate(record, [
      "avatar",
      "avatarUrl",
      "avatar_url",
      "thumbSrc",
      "thumb",
    ]);

    if (!userId && !displayName) {
      continue;
    }

    const normalized: Record<string, unknown> = {
      ...record,
    };
    if (userId) normalized.userId = userId;
    if (displayName) normalized.displayName = displayName;
    if (avatar) normalized.avatar = avatar;

    const dedupeKey = userId || `${displayName}|${avatar}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    rows.push(normalized);
  }

  return rows;
}

function toEpochSeconds(input: unknown): number {
  const numeric =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number(input)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.floor(Date.now() / 1000);
  }

  if (numeric > 10_000_000_000) {
    return Math.floor(numeric / 1000);
  }

  return Math.floor(numeric);
}

function toEpochMs(input: unknown): number {
  const numeric =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number(input)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Date.now();
  }

  if (numeric < 10_000_000_000) {
    return Math.floor(numeric * 1000);
  }

  return Math.floor(numeric);
}

function parseNonNegativeIntOption(label: string, value?: string): number | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return Math.trunc(parsed);
}

function parsePositiveIntOption(label: string, value?: string): number | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return Math.trunc(parsed);
}

program
  .name("openzca")
  .description("Open-source zca-cli compatible wrapper powered by zca-js")
  .version(PKG_VERSION)
  .option("-p, --profile <name>", "Profile name")
  .option("--debug", "Enable debug logging")
  .option("--debug-file <path>", "Debug log file path")
  .showHelpAfterError();

program.hook("preAction", (_parent, actionCommand) => {
  if (!resolveDebugEnabled(actionCommand)) {
    return;
  }
  DEBUG_COMMAND_START.set(actionCommand, Date.now());
  writeDebugLine(
    "command.start",
    {
      command: commandPathLabel(actionCommand),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      profileFlag: getDebugOptions(actionCommand).profile ?? null,
      envProfile: process.env.OPENZCA_PROFILE ?? process.env.ZCA_PROFILE ?? null,
    },
    actionCommand,
  );
});

program.hook("postAction", (_parent, actionCommand) => {
  if (!resolveDebugEnabled(actionCommand)) {
    return;
  }
  const startedAt = DEBUG_COMMAND_START.get(actionCommand);
  writeDebugLine(
    "command.done",
    {
      command: commandPathLabel(actionCommand),
      durationMs: typeof startedAt === "number" ? Date.now() - startedAt : undefined,
    },
    actionCommand,
  );
});

const account = program.command("account").description("Multi-account profile management");

account
  .command("list")
  .alias("ls")
  .alias("l")
  .description("List all account profiles")
  .action(
    wrapAction(async () => {
      const db = await listProfiles();
      const active = await resolveProfileName();

      const rows = await Promise.all(
        Object.entries(db.profiles).map(async ([name, meta]) => ({
          name,
          label: meta.label ?? "",
          default: name === db.defaultProfile,
          active: name === active,
          loggedIn: Boolean(await loadCredentials(name)),
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        })),
      );

      output(rows, false);
    }),
  );

account
  .command("current")
  .alias("whoami")
  .description("Show current active profile")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      console.log(profile);
    }),
  );

account
  .command("switch <name>")
  .alias("use")
  .description("Set default profile")
  .action(
    wrapAction(async (name: string) => {
      await setDefaultProfile(name);
      console.log(`Default profile set to: ${name}`);
    }),
  );

account
  .command("add [name]")
  .alias("new")
  .description("Create a new profile")
  .action(
    wrapAction(async (name = "default") => {
      await addProfile(name);
      console.log(`Profile created: ${name}`);
      console.log(`Next step: openzca --profile ${name} auth login`);
    }),
  );

account
  .command("label <name> <label>")
  .description("Set label for profile")
  .action(
    wrapAction(async (name: string, label: string) => {
      await setProfileLabel(name, label);
      console.log(`Updated label for ${name}`);
    }),
  );

account
  .command("remove <name>")
  .alias("rm")
  .description("Remove profile")
  .action(
    wrapAction(async (name: string) => {
      await removeProfile(name);
      console.log(`Removed profile: ${name}`);
    }),
  );

const auth = program.command("auth").description("Authentication and local cache");

auth
  .command("login")
  .description("Login with QR code")
  .option("-q, --qr-path <path>", "Save QR image path")
  .option(
    "--open-qr",
    "Open QR image in default viewer (or set OPENZCA_QR_OPEN=1)",
  )
  .option(
    "--qr-base64",
    "Output QR code as data URL and return immediately (integration mode)",
  )
  .action(
    wrapAction(
      async (
        opts: { qrPath?: string; qrBase64?: boolean; openQr?: boolean },
        command: Command,
      ) => {
      const profile = await profileForLogin();

      if (opts.qrBase64) {
        await emitQrBase64FromDetachedLogin(profile, opts.qrPath);
        return;
      }

      const { api } = await loginWithQrAndPersist(profile, opts.qrPath, {
        openQr: opts.openQr,
      });
      const me = normalizeAccountInfo(await api.fetchAccountInfo());

      console.log(`Logged in profile ${profile} as ${me.displayName} (${me.userId})`);

      try {
        const cache = await refreshCacheForProfile(profile, api);
        console.log(
          `Cache refreshed: ${cache.friends} friends, ${cache.groups} groups`,
        );
      } catch (error) {
        console.error(
          `Warning: login succeeded but cache refresh failed (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      },
    ),
  );

auth
  .command("login-cred [file]")
  .alias("login-creds")
  .description("Login using credential JSON file")
  .action(
    wrapAction(async (file: string | undefined, command: Command) => {
      const profile = await currentProfile(command);
      const credentials = file
        ? await parseCredentialFile(path.resolve(normalizeMediaInput(file)))
        : toCredentials(
            (await loadCredentials(profile)) ??
              (() => {
                throw new Error(
                  `No saved credentials for profile \"${profile}\". Run: openzca auth login`,
                );
              })(),
          );
      const api = await loginWithCredentialPayload(profile, credentials);
      const me = normalizeAccountInfo(await api.fetchAccountInfo());
      console.log(`Logged in profile ${profile} as ${me.displayName} (${me.userId})`);
    }),
  );

auth
  .command("logout")
  .description("Remove saved credentials from active profile")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      await clearCredentials(profile);
      console.log(`Logged out profile ${profile}`);
    }),
  );

auth
  .command("status")
  .description("Show login status")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      const credentials = await loadCredentials(profile);
      if (!credentials) {
        throw new Error(`Profile ${profile}: not logged in`);
      }

      const api = await createZaloClient().login(toCredentials(credentials));
      const me = normalizeAccountInfo(await api.fetchAccountInfo());

      output(
        {
          profile,
          loggedIn: true,
          userId: me.userId,
          displayName: me.displayName,
          credentialsPath: getCredentialsPath(profile),
        },
        false,
      );
    }),
  );

auth
  .command("cache-refresh")
  .description("Refresh friends/groups cache")
  .action(
    wrapAction(async (command: Command) => {
      const { profile, api } = await requireApi(command);
      const counts = await refreshCacheForProfile(profile, api);
      console.log(
        `Cache refreshed for ${profile}: ${counts.friends} friends, ${counts.groups} groups`,
      );
    }),
  );

auth
  .command("cache-info")
  .description("Show cache metadata")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      const cache = await readCache(profile);
      output(
        {
          profile,
          appHome: APP_HOME,
          profilesFile: PROFILES_FILE,
          friendsCount: cache.friends.length,
          groupsCount: cache.groups.length,
          updatedAt: cache.updatedAt,
        },
        false,
      );
    }),
  );

auth
  .command("cache-clear")
  .description("Clear local cache")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      await clearCache(profile);
      console.log(`Cache cleared for profile ${profile}`);
    }),
  );

const dbCmd = program.command("db").description("Profile-scoped SQLite message database");

dbCmd
  .command("enable")
  .option("--path <path>", "Custom SQLite file path")
  .description("Enable local SQLite persistence for the active profile")
  .action(
    wrapAction(async (opts: { path?: string }, command: Command) => {
      const profile = await currentProfile(command);
      await enableDb(profile, opts.path);
      output(await getDbStatus(profile), false);
    }),
  );

dbCmd
  .command("disable")
  .description("Disable automatic SQLite persistence for the active profile")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      await disableDb(profile);
      await closeDb(profile);
      output(await getDbStatus(profile), false);
    }),
  );

dbCmd
  .command("reset")
  .option("-y, --yes", "Delete the SQLite DB file for the active profile")
  .option("--drop-config", "Also remove the DB config file")
  .option("-j, --json", "JSON output")
  .description("Delete the local SQLite DB for the active profile")
  .action(
    wrapAction(async (
      opts: { yes?: boolean; dropConfig?: boolean; json?: boolean },
      command: Command,
    ) => {
      if (!opts.yes) {
        const confirmed = await confirmDestructiveAction(
          "Reset the local SQLite DB for the active profile?",
        );
        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }
      }
      const profile = await currentProfile(command);
      const dbPath = await resolveDbPath(profile);
      const configPath = getDbConfigPath(profile);
      await closeDb(profile);

      const removedPaths: string[] = [];
      const deleteIfExists = async (filename: string) => {
        try {
          await fs.unlink(filename);
          removedPaths.push(filename);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      };

      await deleteIfExists(dbPath);
      await deleteIfExists(`${dbPath}-wal`);
      await deleteIfExists(`${dbPath}-shm`);

      if (opts.dropConfig) {
        await deleteIfExists(configPath);
      }

      const status = await getDbStatus(profile);
      output(
        {
          profile,
          removedPaths,
          droppedConfig: Boolean(opts.dropConfig),
          status: {
            enabled: status.enabled,
            path: status.path,
            exists: status.exists,
            messageCount: status.messageCount,
            threadCount: status.threadCount,
            groupCount: status.groupCount,
            userCount: status.userCount,
          },
        },
        Boolean(opts.json),
      );
    }),
  );

dbCmd
  .command("status")
  .option("-j, --json", "JSON output")
  .description("Show DB status for the active profile")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      const config = await readDbConfig(profile);
      const status = await getDbStatus(profile);
      const syncRows = await listSyncState({ profile });
      output(
        {
          profile,
          enabled: status.enabled,
          path: await resolveDbPath(profile),
          exists: status.exists,
          configuredPath: config.path ?? null,
          messageCount: status.messageCount,
          threadCount: status.threadCount,
          groupCount: status.groupCount,
          userCount: status.userCount,
          syncStates: {
            total: syncRows.length,
            synced: syncRows.filter((row) => row.status === "synced").length,
            errors: syncRows.filter((row) => row.status === "error").length,
          },
          lastMessageAtMs: status.lastMessageAtMs ?? null,
          updatedAt: status.updatedAt ?? null,
        },
        Boolean(opts.json),
      );
    }),
  );

const dbMe = dbCmd.command("me").description("Query stored self profile data");

dbMe
  .command("info")
  .option("-j, --json", "JSON output")
  .description("Show stored self profile info")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      const row = await getSelfProfile(profile);
      if (!row?.info) {
        throw new Error("No stored self profile in DB. Run `openzca db sync` first.");
      }
      output(row.info, Boolean(opts.json));
    }),
  );

dbMe
  .command("id")
  .description("Show stored self user ID")
  .action(
    wrapAction(async (command: Command) => {
      const profile = await currentProfile(command);
      const row = await getSelfProfile(profile);
      if (!row?.userId) {
        throw new Error("No stored self profile in DB. Run `openzca db sync` first.");
      }
      console.log(row.userId);
    }),
  );

const dbGroup = dbCmd.command("group").description("Query stored group data");

dbGroup
  .command("list")
  .option("-j, --json", "JSON output")
  .description("List groups stored in the local DB")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      output(await listGroups(profile), Boolean(opts.json));
    }),
  );

dbGroup
  .command("info <groupId>")
  .option("-j, --json", "JSON output")
  .description("Show stored info for a group")
  .action(
    wrapAction(async (groupId: string, opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      const row = await getThreadInfo({ profile, threadId: groupId, threadType: "group" });
      if (!row) {
        throw new Error(`Group not found in DB: ${groupId}`);
      }
      output(row, Boolean(opts.json));
    }),
  );

dbGroup
  .command("members <groupId>")
  .option("-j, --json", "JSON output")
  .description("List stored members for a group")
  .action(
    wrapAction(async (groupId: string, opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      output(await listThreadMembers({ profile, threadId: groupId }), Boolean(opts.json));
    }),
  );

dbGroup
  .command("messages <groupId>")
  .option("--since <duration>", "Rolling window ending now: duration like 30s, 7m, 24h, 7d, or 2w")
  .option("--from <time>", "Lower time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--until <time>", "Upper time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--to <time>", "Alias for --until")
  .option("--limit <count>", "Maximum number of rows")
  .option("--all", "Return all matching rows")
  .option("--oldest-first", "Sort oldest-first instead of newest-first")
  .option("-j, --json", "JSON output")
  .description("List stored messages for a group")
  .action(
    wrapAction(async (
      groupId: string,
      opts: {
        since?: string;
        from?: string;
        until?: string;
        to?: string;
        limit?: string;
        all?: boolean;
        oldestFirst?: boolean;
        json?: boolean;
      },
      command: Command,
    ) => {
      const profile = await currentProfile(command);
      const { sinceMs, untilMs, limit, newestFirst } = resolveMessageQueryOptions(opts);
      const rows = await listMessages({
        profile,
        threadId: groupId,
        threadType: "group",
        sinceMs,
        untilMs,
        limit,
        newestFirst,
      });
      output(
        {
          groupId,
          count: rows.length,
          messages: rows,
        },
        Boolean(opts.json),
      );
    }),
  );

const dbFriend = dbCmd.command("friend").description("Query stored friend directory data");

dbFriend
  .command("list")
  .option("-j, --json", "JSON output")
  .description("List friends stored in the local DB")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      output(await listFriends(profile), Boolean(opts.json));
    }),
  );

dbFriend
  .command("find <query>")
  .option("-j, --json", "JSON output")
  .description("Find stored friends by ID or name")
  .action(
    wrapAction(async (query: string, opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      output(await findFriends({ profile, query }), Boolean(opts.json));
    }),
  );

dbFriend
  .command("info <userId>")
  .option("-j, --json", "JSON output")
  .description("Show stored info for a friend")
  .action(
    wrapAction(async (userId: string, opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      const row = await getFriendInfo({ profile, userId });
      if (!row) {
        throw new Error(`Friend not found in DB: ${userId}`);
      }
      output(row, Boolean(opts.json));
    }),
  );

dbFriend
  .command("messages <userId>")
  .option("--since <duration>", "Rolling window ending now: duration like 30s, 7m, 24h, 7d, or 2w")
  .option("--from <time>", "Lower time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--until <time>", "Upper time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--to <time>", "Alias for --until")
  .option("--limit <count>", "Maximum number of rows")
  .option("--all", "Return all matching rows")
  .option("--oldest-first", "Sort oldest-first instead of newest-first")
  .option("-j, --json", "JSON output")
  .description("List stored direct-message rows for a friend")
  .action(
    wrapAction(async (
      userId: string,
      opts: {
        since?: string;
        from?: string;
        until?: string;
        to?: string;
        limit?: string;
        all?: boolean;
        oldestFirst?: boolean;
        json?: boolean;
      },
      command: Command,
    ) => {
      const profile = await currentProfile(command);
      const { sinceMs, untilMs, limit, newestFirst } = resolveMessageQueryOptions(opts);
      const rows = await listMessages({
        profile,
        threadId: userId,
        threadType: "user",
        sinceMs,
        untilMs,
        limit,
        newestFirst,
      });
      output(
        {
          userId,
          count: rows.length,
          messages: rows,
        },
        Boolean(opts.json),
      );
    }),
  );

const dbChat = dbCmd
  .command("chat")
  .argument("[chatId]")
  .option("-g, --group", "Read as a group chat")
  .option("--since <duration>", "Rolling window ending now: duration like 30s, 7m, 24h, 7d, or 2w")
  .option("--from <time>", "Lower time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--until <time>", "Upper time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--to <time>", "Alias for --until")
  .option("--limit <count>", "Maximum number of rows")
  .option("--all", "Return all matching rows")
  .option("--oldest-first", "Sort oldest-first instead of newest-first")
  .option("-j, --json", "JSON output")
  .description("Query stored conversation data")
  .action(
    wrapAction(async (
      chatId: string | undefined,
      opts: {
        group?: boolean;
        since?: string;
        from?: string;
        until?: string;
        to?: string;
        limit?: string;
        all?: boolean;
        oldestFirst?: boolean;
        json?: boolean;
      },
      command: Command,
    ) => {
      if (!chatId) {
        command.help();
        return;
      }
      const profile = await currentProfile(command);
      const threadType = await resolveStoredChatThreadType(profile, chatId, opts.group);
      const { sinceMs, untilMs, limit, newestFirst } = resolveMessageQueryOptions(opts);
      const rows = await listMessages({
        profile,
        threadId: chatId,
        threadType,
        sinceMs,
        untilMs,
        limit,
        newestFirst,
      });
      output(
        {
          chatId,
          threadType,
          count: rows.length,
          messages: rows,
        },
        Boolean(opts.json),
      );
    }),
  );

dbChat
  .command("list")
  .option("-j, --json", "JSON output")
  .description("List chats stored in the local DB")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      output(await listChats(profile), Boolean(opts.json));
    }),
  );

dbChat
  .command("info <chatId>")
  .option("-g, --group", "Read as a group chat")
  .option("-j, --json", "JSON output")
  .description("Show stored info for a chat")
  .action(
    wrapAction(async (
      chatId: string,
      opts: { group?: boolean; json?: boolean },
      command: Command,
    ) => {
      const profile = await currentProfile(command);
      const row = await getThreadInfo({
        profile,
        threadId: chatId,
        threadType: opts.group ? "group" : undefined,
      });
      if (!row) {
        throw new Error(`Chat not found in DB: ${chatId}`);
      }
      output(row, Boolean(opts.json));
    }),
  );

dbChat
  .command("messages <chatId>")
  .option("-g, --group", "Read as a group chat")
  .option("--since <duration>", "Rolling window ending now: duration like 30s, 7m, 24h, 7d, or 2w")
  .option("--from <time>", "Lower time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--until <time>", "Upper time bound: ISO timestamp, date, or unix seconds/ms")
  .option("--to <time>", "Alias for --until")
  .option("--limit <count>", "Maximum number of rows")
  .option("--all", "Return all matching rows")
  .option("--oldest-first", "Sort oldest-first instead of newest-first")
  .option("-j, --json", "JSON output")
  .description("List stored messages for a chat")
  .action(
    wrapAction(async (
      chatId: string,
      opts: {
        group?: boolean;
        since?: string;
        from?: string;
        until?: string;
        to?: string;
        limit?: string;
        all?: boolean;
        oldestFirst?: boolean;
        json?: boolean;
      },
      command: Command,
    ) => {
      const profile = await currentProfile(command);
      const threadType = await resolveStoredChatThreadType(profile, chatId, opts.group);
      const { sinceMs, untilMs, limit, newestFirst } = resolveMessageQueryOptions(opts);
      const rows = await listMessages({
        profile,
        threadId: chatId,
        threadType,
        sinceMs,
        untilMs,
        limit,
        newestFirst,
      });
      output(
        {
          chatId,
          threadType,
          count: rows.length,
          messages: rows,
        },
        Boolean(opts.json),
      );
    }),
  );

const dbMessage = dbCmd.command("message").description("Query stored messages");

dbMessage
  .command("get <id>")
  .option("-j, --json", "JSON output")
  .description("Read one stored message by msgId, cliMsgId, or internal uid")
  .action(
    wrapAction(async (id: string, opts: { json?: boolean }, command: Command) => {
      const profile = await currentProfile(command);
      const row = await getMessageById({ profile, id });
      if (!row) {
        throw new Error(`Message not found in DB: ${id}`);
      }
      output(row, Boolean(opts.json));
    }),
  );

const dbSync = dbCmd.command("sync").description("Sync discoverable data into the local DB");
dbSync.enablePositionalOptions();

dbSync
  .option("-n, --count <count>", "Recent DM/chat messages to fetch per window", "200")
  .option("-j, --json", "JSON output")
  .action(
    wrapAction(async (opts: { count: string; json?: boolean }, command: Command) => {
      const count = resolveSyncWindowCount(opts.count);
      const progress = createSyncProgressReporter();
      const summary = await runDbSync({
        command,
        mode: "all",
        count,
        progress,
      });
      output(summary, Boolean(opts.json));
    }),
  );

dbSync
  .command("all")
  .option("-n, --count <count>", "Recent DM/chat messages to fetch per window", "200")
  .option("-j, --json", "JSON output")
  .description("Sync full group history, friend directory, and recent DM/chat windows")
  .action(
    wrapAction(async (_opts: { count: string; json?: boolean }, command: Command) => {
      const count = resolveSyncWindowCount(readCliOptionValue(["--count", "-n"]));
      output(
        await runDbSync({ command, mode: "all", count, progress: createSyncProgressReporter() }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

dbSync
  .command("groups")
  .option("-j, --json", "JSON output")
  .description("Sync group directory, members, and full group history")
  .action(
    wrapAction(async (_opts: { json?: boolean }, command: Command) => {
      output(
        await runDbSync({ command, mode: "groups", count: 0, progress: createSyncProgressReporter() }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

dbSync
  .command("friends")
  .option("-j, --json", "JSON output")
  .description("Sync friend directory only")
  .action(
    wrapAction(async (_opts: { json?: boolean }, command: Command) => {
      output(
        await runDbSync({ command, mode: "friends", count: 0, progress: createSyncProgressReporter() }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

dbSync
  .command("chats")
  .option("-n, --count <count>", "Recent messages to fetch per scan/window", "200")
  .option("-j, --json", "JSON output")
  .description("Sync discoverable chat windows (DM/chat sync is best-effort)")
  .action(
    wrapAction(async (_opts: { count: string; json?: boolean }, command: Command) => {
      const count = resolveSyncWindowCount(readCliOptionValue(["--count", "-n"]));
      output(
        await runDbSync({ command, mode: "chats", count, progress: createSyncProgressReporter() }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

dbSync
  .command("group <groupId>")
  .option("-j, --json", "JSON output")
  .description("Sync one group with full group history")
  .action(
    wrapAction(async (groupId: string, _opts: { json?: boolean }, command: Command) => {
      output(
        await runDbSync({
          command,
          mode: "group",
          count: 0,
          groupId,
          progress: createSyncProgressReporter(),
        }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

dbSync
  .command("chat <chatId>")
  .option("-n, --count <count>", "Recent messages to fetch for this chat", "200")
  .option("-j, --json", "JSON output")
  .description("Sync one chat (best-effort for direct-message history)")
  .action(
    wrapAction(async (chatId: string, _opts: { count: string; json?: boolean }, command: Command) => {
      const count = resolveSyncWindowCount(readCliOptionValue(["--count", "-n"]));
      output(
        await runDbSync({
          command,
          mode: "chat",
          count,
          threadId: chatId,
          progress: createSyncProgressReporter(),
        }),
        readCliFlag(["--json", "-j"]),
      );
    }),
  );

const msg = program.command("msg").description("Messaging commands");

msg
  .command("send <threadId> <message>")
  .option("-g, --group", "Send to group")
  .option("--raw", "Send raw text without parsing formatting markers")
  .description("Send text message with formatting (**bold** *italic* __bold__ ~~strike~~ {underline}text{/underline} {red}color{/red} {big}size{/big} lists indents). Group sends also resolve unique @Name/@userId mentions.")
  .action(
    wrapAction(async (threadId: string, message: string, opts: { group?: boolean; raw?: boolean }, command: Command) => {
      const { api, profile } = await requireApi(command);
      const threadType = asThreadType(opts.group);
      const payload = await buildTextSendPayload({
        message,
        raw: opts.raw,
        threadType,
        threadId,
        listGroupMembers: threadType === ThreadType.Group ? (groupId) => listGroupMentionMembers(api, groupId) : undefined,
      });
      const response = await api.sendMessage(payload, threadId, threadType);
      output(response, false);
      if (await shouldWriteToDb(profile)) {
        scheduleDbWrite(profile, command, "msg.send.db.persist_error", async () => {
          await persistOutgoingMessageBestEffort({
            profile,
            api,
            threadId,
            group: opts.group,
            text: message,
            msgType: "text",
            response,
            rawPayload: payload,
          });
        });
      }
    }),
  );

msg
  .command("image <threadId> [file]")
  .option("-u, --url <url>", "Image URL (repeatable)", collectValues, [] as string[])
  .option("-m, --message <message>", "Caption")
  .option("-g, --group", "Send to group")
  .description("Send image(s) from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; message?: string; group?: boolean },
        command: Command,
      ) => {
        const { api, profile } = await requireApi(command);

        const normalizedFile = file ? normalizeMediaInput(file) : undefined;
        const files = [normalizedFile, ...normalizeInputList(opts.url)].filter(Boolean) as string[];
        const urlInputs = files.filter((entry) => isHttpUrl(entry));
        const localInputs = files.filter((entry) => !isHttpUrl(entry));
        writeDebugLine(
          "msg.image.inputs",
          {
            threadId,
            isGroup: Boolean(opts.group),
            localInputs,
            urlInputs,
          },
          command,
        );

        const downloaded = await downloadUrlsToTempFiles(urlInputs);
        try {
          const attachments = [...localInputs, ...downloaded.files];
          if (attachments.length === 0) {
            throw new Error("Provide at least one image file or --url.");
          }
          await assertFilesExist(attachments);

          const response = await api.sendMessage(
            {
              msg: opts.message ?? "",
              attachments,
            },
            threadId,
            asThreadType(opts.group),
          );

          output(response, false);
          if (await shouldWriteToDb(profile)) {
            scheduleDbWrite(profile, command, "msg.image.db.persist_error", async () => {
              await persistOutgoingMessageBestEffort({
                profile,
                api,
                threadId,
                group: opts.group,
                text: opts.message ?? "",
                msgType: "image",
                response,
                rawPayload: {
                  msg: opts.message ?? "",
                  attachments,
                },
                media: attachments.map((item) => ({
                  mediaKind: "image",
                  mediaPath: isHttpUrl(item) ? undefined : item,
                  mediaUrl: isHttpUrl(item) ? item : undefined,
                })),
              });
            });
          }
        } finally {
          await downloaded.cleanup();
        }
      },
    ),
  );

msg
  .command("video <threadId> [file]")
  .option("-u, --url <url>", "Video URL (repeatable)", collectValues, [] as string[])
  .option("-m, --message <message>", "Caption")
  .option("--thumbnail <pathOrUrl>", "Thumbnail image path or URL (optional)")
  .option("-g, --group", "Send to group")
  .description("Send video(s) from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; message?: string; group?: boolean; thumbnail?: string },
        command: Command,
      ) => {
        const { api, profile } = await requireApi(command);
        const threadType = asThreadType(opts.group);

        const normalizedFile = file ? normalizeMediaInput(file) : undefined;
        const files = [normalizedFile, ...normalizeInputList(opts.url)].filter(Boolean) as string[];
        const urlInputs = files.filter((entry) => isHttpUrl(entry));
        const localInputs = files.filter((entry) => !isHttpUrl(entry));
        const normalizedThumbnail = opts.thumbnail ? normalizeMediaInput(opts.thumbnail) : undefined;
        const thumbnailUrlInputs =
          normalizedThumbnail && isHttpUrl(normalizedThumbnail) ? [normalizedThumbnail] : [];
        const thumbnailLocalPath =
          normalizedThumbnail && !isHttpUrl(normalizedThumbnail) ? normalizedThumbnail : undefined;
        writeDebugLine(
          "msg.video.inputs",
          {
            threadId,
            isGroup: Boolean(opts.group),
            localInputs,
            urlInputs,
            thumbnail: normalizedThumbnail,
          },
          command,
        );

        const downloaded = await downloadUrlsToTempFiles(urlInputs);
        const downloadedThumbnail = await downloadUrlsToTempFiles(thumbnailUrlInputs);
        try {
          const attachments = [...localInputs, ...downloaded.files];
          if (attachments.length === 0) {
            throw new Error("Provide at least one video file or --url.");
          }
          await assertFilesExist(attachments);
          if (thumbnailLocalPath) {
            await assertFilesExist([thumbnailLocalPath]);
          }

          const enforceSingleOwner = parseBooleanFromEnv("OPENZCA_UPLOAD_ENFORCE_SINGLE_OWNER", true);
          if (enforceSingleOwner) {
            const owner = await readActiveListenerOwner(profile);
            if (owner && owner.pid !== process.pid) {
              throw new Error(
                `Active listener owner detected for profile "${profile}" (pid ${owner.pid}), ` +
                  "but video upload IPC is unavailable. Restart `openzca listen` with latest version " +
                  "or set OPENZCA_UPLOAD_ENFORCE_SINGLE_OWNER=0 to allow fallback listener startup.",
              );
            }
          }

          const ffmpegAvailable = await isFfmpegAvailable();
          const videoPlan = planVideoSendMode({
            files: attachments,
            ffmpegAvailable,
          });

          if (videoPlan.mode === "native") {
            const thumbnailPath = thumbnailLocalPath ?? downloadedThumbnail.files[0];
            try {
              const response = await withUploadListener(api, command, async () =>
                sendNativeVideo({
                  api,
                  threadId,
                  threadType,
                  videoPath: attachments[0],
                  message: opts.message,
                  thumbnailPath,
                }),
              );

              writeDebugLine(
                "msg.video.native.success",
                {
                  threadId,
                  isGroup: Boolean(opts.group),
                  videoPath: attachments[0],
                  thumbnailPath: thumbnailPath ?? null,
                },
                command,
              );
              output(response, false);
              if (await shouldWriteToDb(profile)) {
                scheduleDbWrite(profile, command, "msg.video.db.persist_error", async () => {
                  await persistOutgoingMessageBestEffort({
                    profile,
                    api,
                    threadId,
                    group: opts.group,
                    text: opts.message ?? "",
                    msgType: "video",
                    response,
                    rawPayload: {
                      msg: opts.message ?? "",
                      videoPath: attachments[0],
                      thumbnailPath: thumbnailPath ?? null,
                    },
                    media: [
                      {
                        mediaKind: "video",
                        mediaPath: attachments[0],
                      },
                    ],
                  });
                });
              }
              return;
            } catch (error) {
              writeDebugLine(
                "msg.video.native.failed",
                {
                  threadId,
                  isGroup: Boolean(opts.group),
                  videoPath: attachments[0],
                  thumbnailPath: thumbnailPath ?? null,
                  message: error instanceof Error ? error.message : String(error),
                },
                command,
              );
            }
          } else {
            writeDebugLine(
              "msg.video.native.skipped",
              {
                threadId,
                isGroup: Boolean(opts.group),
                reason: videoPlan.reason,
              },
              command,
            );
          }

          const response = await withUploadListener(api, command, async () =>
            api.sendMessage(
              {
                msg: opts.message ?? "",
                attachments,
              },
              threadId,
              threadType,
            ),
          );

          output(response, false);
          if (await shouldWriteToDb(profile)) {
            scheduleDbWrite(profile, command, "msg.video.db.persist_error", async () => {
              await persistOutgoingMessageBestEffort({
                profile,
                api,
                threadId,
                group: opts.group,
                text: opts.message ?? "",
                msgType: "video",
                response,
                rawPayload: {
                  msg: opts.message ?? "",
                  attachments,
                },
                media: attachments.map((item) => ({
                  mediaKind: "video",
                  mediaPath: isHttpUrl(item) ? undefined : item,
                  mediaUrl: isHttpUrl(item) ? item : undefined,
                })),
              });
            });
          }
        } finally {
          await downloaded.cleanup();
          await downloadedThumbnail.cleanup();
        }
      },
    ),
  );

msg
  .command("voice <threadId> [file]")
  .option("-u, --url <url>", "Voice URL (repeatable)", collectValues, [] as string[])
  .option("-g, --group", "Send to group")
  .description("Send voice message from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; group?: boolean },
        command: Command,
      ) => {
        const { api, profile } = await requireApi(command);
        const type = asThreadType(opts.group);

        const normalizedFile = file ? normalizeMediaInput(file) : undefined;
        const files = [normalizedFile, ...normalizeInputList(opts.url)].filter(Boolean) as string[];
        if (files.length === 0) {
          throw new Error("Provide a voice file or --url.");
        }

        const urlInputs = files.filter((entry) => isHttpUrl(entry));
        const localInputs = files.filter((entry) => !isHttpUrl(entry));
        writeDebugLine(
          "msg.voice.inputs",
          {
            threadId,
            isGroup: Boolean(opts.group),
            localInputs,
            urlInputs,
          },
          command,
        );
        const downloaded = await downloadUrlsToTempFiles(urlInputs);
        try {
          const attachments = [...localInputs, ...downloaded.files];
          await assertFilesExist(attachments);

          const results: unknown[] = [];
          const uploaded = await api.uploadAttachment(attachments, threadId, type);
          for (const item of uploaded) {
            if (item.fileType === "others" || item.fileType === "video") {
              results.push(await api.sendVoice({ voiceUrl: item.fileUrl }, threadId, type));
            }
          }

          if (results.length === 0) {
            throw new Error(
              "No valid voice attachment generated. Use an audio file (e.g. .aac, .mp3, .m4a, .wav, .ogg).",
            );
          }

          output(results, false);
          if (await shouldWriteToDb(profile)) {
            scheduleDbWrite(profile, command, "msg.voice.db.persist_error", async () => {
              await persistOutgoingMessageBestEffort({
                profile,
                api,
                threadId,
                group: opts.group,
                msgType: "voice",
                response: results,
                rawPayload: uploaded,
                media: uploaded.map((item) => ({
                  mediaKind: "voice",
                  mediaUrl:
                    "fileUrl" in item && typeof item.fileUrl === "string"
                      ? item.fileUrl
                      : undefined,
                  rawJson: JSON.stringify(item),
                })),
              });
            });
          }
        } finally {
          await downloaded.cleanup();
        }
      },
    ),
  );

msg
  .command("sticker <threadId> <stickerId>")
  .option("-g, --group", "Send to group")
  .description("Send a sticker by sticker ID")
  .action(
    wrapAction(
      async (
        threadId: string,
        stickerId: string,
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const details = await api.getStickersDetail(Number(stickerId));
        const first = details[0];
        if (!first) {
          throw new Error(`Sticker ${stickerId} not found.`);
        }

        const response = await api.sendSticker(
          {
            id: Number(first.id),
            cateId: Number(first.cateId),
            type: Number(first.type),
          },
          threadId,
          asThreadType(opts.group),
        );
        output(response, false);
      },
    ),
  );

msg
  .command("link <threadId> <url>")
  .option("-g, --group", "Send to group")
  .description("Send link")
  .action(
    wrapAction(async (threadId: string, url: string, opts: { group?: boolean }, command: Command) => {
      const { api, profile } = await requireApi(command);
      const response = await api.sendLink({ link: url }, threadId, asThreadType(opts.group));
      output(response, false);
      if (await shouldWriteToDb(profile)) {
        scheduleDbWrite(profile, command, "msg.link.db.persist_error", async () => {
          await persistOutgoingMessageBestEffort({
            profile,
            api,
            threadId,
            group: opts.group,
            text: url,
            msgType: "link",
            response,
            rawPayload: { link: url },
          });
        });
      }
    }),
  );

msg
  .command("card <threadId> <contactId>")
  .option("-g, --group", "Send to group")
  .description("Send contact card")
  .action(
    wrapAction(
      async (
        threadId: string,
        contactId: string,
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const response = await api.sendCard(
          { userId: contactId },
          threadId,
          asThreadType(opts.group),
        );
        output(response, false);
      },
    ),
  );

msg
  .command("react <msgId> <cliMsgId> <threadId> <reaction>")
  .option("-g, --group", "React in group")
  .description("React to a message")
  .action(
    wrapAction(
      async (
        msgId: string,
        cliMsgId: string,
        threadId: string,
        reaction: string,
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const response = await api.addReaction(parseReaction(reaction), {
          data: {
            msgId,
            cliMsgId,
          },
          threadId,
          type: asThreadType(opts.group),
        });
        output(response, false);
      },
    ),
  );

msg
  .command("typing <threadId>")
  .option("-g, --group", "Typing in group")
  .description("Send typing event")
  .action(
    wrapAction(async (threadId: string, opts: { group?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.sendTypingEvent(
        threadId,
        asThreadType(opts.group),
        DestType.User,
      );
      output(response, false);
    }),
  );

msg
  .command("forward <message> <targets...>")
  .option("-g, --group", "Forward to groups")
  .description("Forward text to multiple targets")
  .action(
    wrapAction(
      async (
        message: string,
        targets: string[],
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const response = await api.forwardMessage(
          { message },
          targets,
          asThreadType(opts.group),
        );
        output(response, false);
      },
    ),
  );

msg
  .command("delete <msgId> <cliMsgId> <uidFrom> <threadId>")
  .option("-g, --group", "Delete in group")
  .option("--only-me", "Delete only for yourself")
  .description("Delete message")
  .action(
    wrapAction(
      async (
        msgId: string,
        cliMsgId: string,
        uidFrom: string,
        threadId: string,
        opts: { group?: boolean; onlyMe?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const response = await api.deleteMessage(
          {
            data: {
              msgId,
              cliMsgId,
              uidFrom,
            },
            threadId,
            type: asThreadType(opts.group),
          },
          Boolean(opts.onlyMe),
        );
        output(response, false);
      },
    ),
  );

msg
  .command("undo <msgId> <cliMsgId> <threadId>")
  .option("-g, --group", "Undo in group")
  .description("Recall your sent message")
  .action(
    wrapAction(
      async (
        msgId: string,
        cliMsgId: string,
        threadId: string,
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const response = await api.undo(
          {
            msgId,
            cliMsgId,
          },
          threadId,
          asThreadType(opts.group),
        );
        output(response, false);
      },
    ),
  );

msg
  .command("edit <msgId> <cliMsgId> <threadId> <message>")
  .option("-g, --group", "Edit in group")
  .description("Edit message (compatibility shim: recall old message then resend new text)")
  .action(
    wrapAction(
      async (
        msgId: string,
        cliMsgId: string,
        threadId: string,
        message: string,
        opts: { group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const type = asThreadType(opts.group);
        const undoResponse = await api.undo(
          {
            msgId,
            cliMsgId,
          },
          threadId,
          type,
        );
        const sendResponse = await api.sendMessage(message, threadId, type);
        output(
          {
            mode: "undo+send",
            nativeEditSupported: false,
            undo: undoResponse,
            send: sendResponse,
          },
          false,
        );
      },
    ),
  );

msg
  .command("upload <arg1> [arg2]")
  .option("-u, --url <url>", "File URL (repeatable)", collectValues, [] as string[])
  .option("-g, --group", "Upload in group")
  .description("Upload and send file(s)")
  .action(
    wrapAction(
      async (
        arg1: string,
        arg2: string | undefined,
        opts: { url?: string[]; group?: boolean },
        command: Command,
      ) => {
        const { api, profile } = await requireApi(command);
        const inputs = normalizeInputList(opts.url);
        const urlInputs = inputs.filter((entry) => isHttpUrl(entry));
        const localInputs = inputs.filter((entry) => !isHttpUrl(entry));

        const [threadId, file] = arg2 ? [arg2, arg1] : [arg1, undefined];
        const threadResolution = await resolveUploadThreadType(
          api,
          profile,
          threadId,
          opts.group,
          command,
        );
        const normalizedFile = file ? normalizeMediaInput(file) : undefined;
        const localFiles = [normalizedFile, ...localInputs].filter(Boolean) as string[];
        writeDebugLine(
          "msg.upload.inputs",
          {
            threadId,
            explicitGroupFlag: Boolean(opts.group),
            isGroup: threadResolution.type === ThreadType.Group,
            threadType: threadResolution.type === ThreadType.Group ? "group" : "user",
            threadTypeReason: threadResolution.reason,
            localFiles,
            urlInputs,
          },
          command,
        );

        const downloaded = await downloadUrlsToTempFiles(urlInputs);
        try {
          const attachments = [...localFiles, ...downloaded.files];
          if (attachments.length === 0) {
            throw new Error(
              "Provide file and threadId (upload <file> <threadId>) or use --url.",
            );
          }
          await assertFilesExist(attachments);

          const ipcResult = await tryUploadViaListenerIpc(
            profile,
            threadId,
            threadResolution.type,
            attachments,
            command,
          );
          if (ipcResult.handled) {
            writeDebugLine(
              "msg.upload.ipc.done",
              {
                threadId,
                threadType: threadResolution.type === ThreadType.Group ? "group" : "user",
              },
              command,
            );
            output(ipcResult.response, false);
            return;
          }

          writeDebugLine(
            "msg.upload.ipc.fallback",
            {
              threadId,
              threadType: threadResolution.type === ThreadType.Group ? "group" : "user",
              reason: ipcResult.reason,
            },
            command,
          );

          const enforceSingleOwner = parseBooleanFromEnv("OPENZCA_UPLOAD_ENFORCE_SINGLE_OWNER", true);
          if (enforceSingleOwner) {
            const owner = await readActiveListenerOwner(profile);
            if (owner && owner.pid !== process.pid) {
              throw new Error(
                `Active listener owner detected for profile "${profile}" (pid ${owner.pid}), ` +
                  "but upload IPC is unavailable. Restart `openzca listen` with latest version " +
                  "or set OPENZCA_UPLOAD_ENFORCE_SINGLE_OWNER=0 to allow fallback listener startup.",
              );
            }
          }

          const response = await withUploadListener(api, command, async () =>
            api.sendMessage(
              {
                msg: "",
                attachments,
              },
              threadId,
              threadResolution.type,
            ),
          );
          output(response, false);
        } finally {
          await downloaded.cleanup();
        }
      },
    ),
  );

msg
  .command("recent <threadId>")
  .option("-g, --group", "List recent messages for group thread")
  .option("-n, --count <count>", "Number of messages", "20")
  .option("--source <source>", "Message source: live, db, or auto", "live")
  .option("-j, --json", "JSON output")
  .description("List recent messages (group uses direct history API when available)")
  .action(
    wrapAction(
      async (
        threadId: string,
        opts: { group?: boolean; count: string; json?: boolean; source?: string },
        command: Command,
      ) => {
        const { api, profile } = await requireApi(command);
        const parsedCount = Number(opts.count);
        const count = Number.isFinite(parsedCount)
          ? Math.min(Math.max(Math.trunc(parsedCount), 1), 200)
          : 20;

        const threadType = opts.group ? ThreadType.Group : ThreadType.User;
        const source = (opts.source ?? "live").trim().toLowerCase();
        if (!["live", "db", "auto"].includes(source)) {
          throw new Error("--source must be one of: live, db, auto");
        }

        let rows =
          source === "db" || source === "auto"
            ? await listRecentMessages({
                profile,
                threadId,
                threadType: opts.group ? "group" : "user",
                count,
              })
            : [];

        if (source === "live" || (source === "auto" && rows.length === 0)) {
          const messages = opts.group
            ? await fetchRecentGroupMessagesViaApi(api, threadId, count)
            : await fetchRecentUserMessagesViaListener(
                api,
                threadId,
                count,
              );
          rows = messages.map((message) => ({
            msgId: message.data.msgId,
            cliMsgId: message.data.cliMsgId,
            threadId: message.threadId || threadId,
            threadType: message.type === ThreadType.Group ? "group" : "user",
            senderId: message.data.uidFrom,
            senderName: message.data.dName ?? "",
            ts: message.data.ts,
            msgType: message.data.msgType,
            undo: {
              msgId: message.data.msgId,
              cliMsgId: message.data.cliMsgId,
              threadId: message.threadId || threadId,
              group: message.type === ThreadType.Group,
            },
            content:
              typeof message.data.content === "string"
                ? message.data.content
                : JSON.stringify(message.data.content),
          }));
        }

        if (opts.json) {
          output(
            {
              threadId,
              threadType: threadType === ThreadType.Group ? "group" : "user",
              count: rows.length,
              messages: rows,
            },
            true,
          );
          return;
        }

        output(rows, false);
      },
    ),
  );

msg
  .command("pin <threadId>")
  .option("-g, --group", "Pin group conversation")
  .description("Pin conversation")
  .action(
    wrapAction(async (threadId: string, opts: { group?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const type = asThreadType(opts.group);
      const response = await api.setPinnedConversations(true, threadId, type);
      output(
        {
          threadId,
          threadType: type === ThreadType.Group ? "group" : "user",
          pinned: true,
          response,
        },
        false,
      );
    }),
  );

msg
  .command("unpin <threadId>")
  .option("-g, --group", "Unpin group conversation")
  .description("Unpin conversation")
  .action(
    wrapAction(async (threadId: string, opts: { group?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const type = asThreadType(opts.group);
      const response = await api.setPinnedConversations(false, threadId, type);
      output(
        {
          threadId,
          threadType: type === ThreadType.Group ? "group" : "user",
          pinned: false,
          response,
        },
        false,
      );
    }),
  );

msg
  .command("list-pins")
  .option("-j, --json", "JSON output")
  .description("List pinned conversations")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.getPinConversations();
      if (opts.json) {
        output(response, true);
        return;
      }
      output(
        response.conversations.map((threadId) => ({
          threadId,
          pinned: true,
        })),
        false,
      );
    }),
  );

msg
  .command("member-info <userId>")
  .option("-j, --json", "JSON output")
  .description("Get member/user profile info")
  .action(
    wrapAction(async (userId: string, opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.getUserInfo(userId);
      if (opts.json) {
        output(response, true);
        return;
      }

      const profiles = (response.changed_profiles ?? {}) as Record<string, Record<string, unknown>>;
      const matchedProfile =
        profiles[userId] ??
        profiles[`${userId}_0`] ??
        Object.values(profiles)[0] ??
        null;

      output(
        {
          userId,
          found: Boolean(matchedProfile),
          profile: matchedProfile,
        },
        false,
      );
    }),
  );

const group = program.command("group").description("Group management");

group
  .command("list")
  .option("-j, --json", "JSON output")
  .description("List groups")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const groups = await buildGroupsDetailed(api);

      if (opts.json) {
        output(groups, true);
        return;
      }

      output(
        groups.map((item) => ({
          groupId: item.groupId,
          name: item.name,
          totalMember: item.totalMember,
          type: item.type,
        })),
      );
    }),
  );

group
  .command("info <groupId>")
  .description("Get group info")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      const data = await api.getGroupInfo(groupId);
      output(data.gridInfoMap[groupId], false);
    }),
  );

group
  .command("members <groupId>")
  .option("-j, --json", "JSON output")
  .description("List group members")
  .action(
    wrapAction(async (groupId: string, opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const rows = await listGroupMemberRows(api, groupId);

      if (opts.json) {
        output(rows, true);
        return;
      }

      output(rows, false);
    }),
  );

group
  .command("create <name> <members...>")
  .description("Create new group")
  .action(
    wrapAction(async (name: string, members: string[], command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.createGroup({
        name,
        members,
      });
      output(response, false);
    }),
  );

const groupPoll = group.command("poll").description("Group poll management");

groupPoll
  .command("create <groupId>")
  .requiredOption("-q, --question <text>", "Poll question")
  .requiredOption("-o, --option <text>", "Poll option (repeatable)", collectValues, [] as string[])
  .option("--multi", "Allow multiple choices")
  .option("--allow-add-option", "Allow members to add new options")
  .option("--hide-vote-preview", "Hide results until the member votes")
  .option("--anonymous", "Hide voters")
  .option("--expire-ms <ms>", "Poll expiration time in milliseconds")
  .description("Create a poll in a group")
  .action(
    wrapAction(
      async (
        groupId: string,
        opts: {
          question?: string;
          option?: string[];
          multi?: boolean;
          allowAddOption?: boolean;
          hideVotePreview?: boolean;
          anonymous?: boolean;
          expireMs?: string;
        },
        command: Command,
      ) => {
        const pollOptions = buildCreatePollOptions(opts);
        const { api } = await requireApi(command);
        output(await api.createPoll(pollOptions, groupId), false);
      },
    ),
  );

groupPoll
  .command("detail <pollId>")
  .description("Get poll detail")
  .action(
    wrapAction(async (pollId: string, command: Command) => {
      const normalizedPollId = parsePollId(pollId);
      const { api } = await requireApi(command);
      output(await api.getPollDetail(normalizedPollId), false);
    }),
  );

groupPoll
  .command("vote <pollId>")
  .requiredOption("-o, --option <id>", "Poll option id (repeatable)", collectValues, [] as string[])
  .description("Vote on a group poll")
  .action(
    wrapAction(
      async (
        pollId: string,
        opts: { option?: string[] },
        command: Command,
      ) => {
        const normalizedPollId = parsePollId(pollId);
        const optionIds = parsePollOptionIds(opts.option);
        const { api } = await requireApi(command);
        const response = await api.votePoll(
          normalizedPollId,
          optionIds.length === 1 ? optionIds[0] : optionIds,
        );
        output(response, false);
      },
    ),
  );

groupPoll
  .command("lock <pollId>")
  .description("Close a poll")
  .action(
    wrapAction(async (pollId: string, command: Command) => {
      const normalizedPollId = parsePollId(pollId);
      const { api } = await requireApi(command);
      output(await api.lockPoll(normalizedPollId), false);
    }),
  );

groupPoll
  .command("share <pollId>")
  .description("Share a poll")
  .action(
    wrapAction(async (pollId: string, command: Command) => {
      const normalizedPollId = parsePollId(pollId);
      const { api } = await requireApi(command);
      output(await api.sharePoll(normalizedPollId), false);
    }),
  );

group
  .command("rename <groupId> <name>")
  .description("Rename group")
  .action(
    wrapAction(async (groupId: string, name: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.changeGroupName(name, groupId);
      output(response, false);
    }),
  );

group
  .command("avatar <groupId> <file>")
  .description("Change group avatar")
  .action(
    wrapAction(async (groupId: string, file: string, command: Command) => {
      const { api } = await requireApi(command);
      const normalizedFile = normalizeMediaInput(file);
      await assertFilesExist([normalizedFile]);
      const response = await api.changeGroupAvatar(normalizedFile, groupId);
      output(response, false);
    }),
  );

group
  .command("settings <groupId>")
  .option("--lock-name", "Lock group name/avatar")
  .option("--unlock-name", "Unlock group name/avatar")
  .option("--sign-admin", "Highlight admin messages")
  .option("--no-sign-admin", "Disable admin message highlight")
  .description("Update group settings")
  .action(
    wrapAction(
      async (
        groupId: string,
        opts: {
          lockName?: boolean;
          unlockName?: boolean;
          signAdmin?: boolean;
          noSignAdmin?: boolean;
        },
        command: Command,
      ) => {
        if (
          !opts.lockName &&
          !opts.unlockName &&
          !opts.signAdmin &&
          !opts.noSignAdmin
        ) {
          throw new Error("Provide at least one setting option.");
        }

        const { api } = await requireApi(command);
        const current = (await api.getGroupInfo(groupId)).gridInfoMap[groupId]?.setting;
        if (!current) {
          throw new Error(`Group not found: ${groupId}`);
        }

        const payload = {
          blockName: Boolean(current.blockName),
          signAdminMsg: Boolean(current.signAdminMsg),
          setTopicOnly: Boolean(current.setTopicOnly),
          enableMsgHistory: Boolean(current.enableMsgHistory),
          joinAppr: Boolean(current.joinAppr),
          lockCreatePost: Boolean(current.lockCreatePost),
          lockCreatePoll: Boolean(current.lockCreatePoll),
          lockSendMsg: Boolean(current.lockSendMsg),
          lockViewMember: Boolean(current.lockViewMember),
        };

        if (opts.lockName) payload.blockName = true;
        if (opts.unlockName) payload.blockName = false;
        if (opts.signAdmin) payload.signAdminMsg = true;
        if (opts.noSignAdmin) payload.signAdminMsg = false;

        const response = await api.updateGroupSettings(payload, groupId);
        output(response, false);
      },
    ),
  );

group
  .command("add <groupId> <userIds...>")
  .description("Add users to group")
  .action(
    wrapAction(async (groupId: string, userIds: string[], command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.addUserToGroup(userIds, groupId);
      output(response, false);
    }),
  );

group
  .command("remove <groupId> <userIds...>")
  .description("Remove users from group")
  .action(
    wrapAction(async (groupId: string, userIds: string[], command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.removeUserFromGroup(userIds, groupId);
      output(response, false);
    }),
  );

group
  .command("add-deputy <groupId> <userId>")
  .description("Promote deputy")
  .action(
    wrapAction(async (groupId: string, userId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.addGroupDeputy(userId, groupId);
      output(response, false);
    }),
  );

group
  .command("remove-deputy <groupId> <userId>")
  .description("Demote deputy")
  .action(
    wrapAction(async (groupId: string, userId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.removeGroupDeputy(userId, groupId);
      output(response, false);
    }),
  );

group
  .command("transfer <groupId> <newOwnerId>")
  .description("Transfer ownership")
  .action(
    wrapAction(async (groupId: string, newOwnerId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.changeGroupOwner(newOwnerId, groupId);
      output(response, false);
    }),
  );

group
  .command("block <groupId> <userId>")
  .description("Block member")
  .action(
    wrapAction(async (groupId: string, userId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.addGroupBlockedMember(userId, groupId);
      output(response, false);
    }),
  );

group
  .command("unblock <groupId> <userId>")
  .description("Unblock member")
  .action(
    wrapAction(async (groupId: string, userId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.removeGroupBlockedMember(userId, groupId);
      output(response, false);
    }),
  );

group
  .command("blocked <groupId>")
  .description("List blocked members")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.getGroupBlockedMember({}, groupId);
      output(response.blocked_members, false);
    }),
  );

group
  .command("enable-link <groupId>")
  .description("Enable invite link")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.enableGroupLink(groupId), false);
    }),
  );

group
  .command("disable-link <groupId>")
  .description("Disable invite link")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.disableGroupLink(groupId), false);
    }),
  );

group
  .command("link-detail <groupId>")
  .description("Get invite link detail")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getGroupLinkDetail(groupId), false);
    }),
  );

group
  .command("join-link <linkId>")
  .description("Join by invite link")
  .action(
    wrapAction(async (linkId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.joinGroupLink(linkId), false);
    }),
  );

group
  .command("pending <groupId>")
  .description("List pending member requests")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getPendingGroupMembers(groupId), false);
    }),
  );

group
  .command("review <groupId> <userId> <action>")
  .description("Approve or deny pending request")
  .action(
    wrapAction(
      async (
        groupId: string,
        userId: string,
        action: string,
        command: Command,
      ) => {
        const normalized = action.trim().toLowerCase();
        if (!["approve", "deny"].includes(normalized)) {
          throw new Error('Action must be "approve" or "deny".');
        }

        const { api } = await requireApi(command);
        const result = await api.reviewPendingMemberRequest(
          {
            members: userId,
            isApprove: normalized === "approve",
          },
          groupId,
        );

        const status = result[userId];
        if (status === ReviewPendingMemberRequestStatus.SUCCESS) {
          console.log(`${normalized} success for user ${userId}`);
        } else {
          output(result, false);
        }
      },
    ),
  );

group
  .command("leave <groupId>")
  .description("Leave group")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.leaveGroup(groupId), false);
    }),
  );

group
  .command("disperse <groupId>")
  .description("Disperse group")
  .action(
    wrapAction(async (groupId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.disperseGroup(groupId), false);
    }),
  );

const friend = program.command("friend").description("Friend management");

friend
  .command("list")
  .option("-j, --json", "JSON output")
  .description("List all friends")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const friends = await api.getAllFriends();
      if (opts.json) {
        output(friends, true);
        return;
      }

      output(
        friends.map((item) => ({
          userId: item.userId,
          displayName: item.displayName,
          username: item.username,
          phone: item.phoneNumber,
        })),
      );
    }),
  );

friend
  .command("find <query>")
  .option("-j, --json", "JSON output")
  .description("Find user by phone/username/name")
  .action(
    wrapAction(async (query: string, opts: { json?: boolean }, command: Command) => {
      const { profile, api } = await requireApi(command);
      let result: unknown;

      if (/^\d+$/.test(query.replace(/^\+/, ""))) {
        result = await api.findUser(query);
      } else {
        try {
          const withUsernameSearch = api as unknown as {
            findUserByUsername: (value: string) => Promise<unknown>;
          };
          result = await withUsernameSearch.findUserByUsername(query);
        } catch {
          const cache = await readCache(profile);
          const lowered = query.toLowerCase();
          const friends = cache.friends as Array<Record<string, string>>;
          const matched = friends.filter((item) =>
            [
              item.displayName,
              item.zaloName,
              item.username,
              item.userId,
              item.phoneNumber,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(lowered)),
          );
          result = matched;
        }
      }

      const rows = normalizeFriendLookupRows(result);
      const shouldJson = Boolean(opts.json) || !process.stdout.isTTY;

      if (shouldJson) {
        output(rows, true);
        return;
      }

      if (rows.length > 0) {
        output(rows, false);
        return;
      }

      output(result, false);
    }),
  );

friend
  .command("online")
  .option("-j, --json", "JSON output")
  .description("List online friends")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      try {
        const data = await api.getFriendOnlines();
        output(data.onlines, Boolean(opts.json));
      } catch (error) {
        // zca-js may throw JSON parse error for unexpected status payloads.
        // Fallback to active flags from friend list to keep command usable.
        const friends = await api.getAllFriends();
        const fallback = friends
          .filter(
            (friendItem) =>
              Number(friendItem.isActive) === 1 ||
              Number(friendItem.isActiveWeb) === 1 ||
              Number(friendItem.isActivePC) === 1,
          )
          .map((friendItem) => ({
            userId: friendItem.userId,
            status: "online",
            displayName: friendItem.displayName,
            source: "fallback_active_flags",
          }));

        console.error(
          `Warning: friend online fallback used (${error instanceof Error ? error.message : String(error)})`,
        );
        output(fallback, Boolean(opts.json));
      }
    }),
  );

friend
  .command("recommendations")
  .option("-j, --json", "JSON output")
  .description("Get recommendations")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const data = await api.getFriendRecommendations();
      output(data.recommItems, Boolean(opts.json));
    }),
  );

friend
  .command("add <userId>")
  .option("-m, --message <message>", "Request message", "Hello!")
  .description("Send friend request")
  .action(
    wrapAction(
      async (
        userId: string,
        opts: { message: string },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        output(await api.sendFriendRequest(opts.message, userId), false);
      },
    ),
  );

friend
  .command("accept <userId>")
  .description("Accept friend request")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.acceptFriendRequest(userId), false);
    }),
  );

friend
  .command("reject <userId>")
  .description("Reject friend request")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.rejectFriendRequest(userId), false);
    }),
  );

friend
  .command("cancel <userId>")
  .description("Cancel sent friend request")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.undoFriendRequest(userId), false);
    }),
  );

friend
  .command("sent")
  .option("-j, --json", "JSON output")
  .description("List sent requests")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getSentFriendRequest(), Boolean(opts.json));
    }),
  );

friend
  .command("request-status <userId>")
  .description("Request status for user")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getFriendRequestStatus(userId), false);
    }),
  );

friend
  .command("remove <userId>")
  .description("Remove friend")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.removeFriend(userId), false);
    }),
  );

friend
  .command("alias <userId> <alias>")
  .description("Set friend alias")
  .action(
    wrapAction(async (userId: string, alias: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.changeFriendAlias(alias, userId), false);
    }),
  );

friend
  .command("remove-alias <userId>")
  .description("Remove friend alias")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.removeFriendAlias(userId), false);
    }),
  );

friend
  .command("aliases")
  .option("-j, --json", "JSON output")
  .description("List aliases")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getAliasList(), Boolean(opts.json));
    }),
  );

friend
  .command("block <userId>")
  .description("Block user")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.blockUser(userId), false);
    }),
  );

friend
  .command("unblock <userId>")
  .description("Unblock user")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.unblockUser(userId), false);
    }),
  );

friend
  .command("block-feed <userId>")
  .description("Block viewing your feed")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.blockViewFeed(true, userId), false);
    }),
  );

friend
  .command("unblock-feed <userId>")
  .description("Unblock viewing your feed")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.blockViewFeed(false, userId), false);
    }),
  );

friend
  .command("boards <conversationId>")
  .option("-j, --json", "JSON output")
  .description("Get boards in conversation")
  .action(
    wrapAction(async (conversationId: string, opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getFriendBoardList(conversationId), Boolean(opts.json));
    }),
  );

const me = program.command("me").description("Profile/account commands");

me
  .command("info")
  .option("-j, --json", "JSON output")
  .description("Get account info")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const outputValue = normalizeMeInfoOutput(await api.fetchAccountInfo());
      if (opts.json) {
        output(outputValue, true);
        return;
      }
      output(outputValue, false);
    }),
  );

me
  .command("id")
  .description("Get own user ID")
  .action(
    wrapAction(async (command: Command) => {
      const { api } = await requireApi(command);
      console.log(api.getOwnId());
    }),
  );

me
  .command("update")
  .option("--name <name>", "Display name")
  .option("--gender <gender>", "male|female")
  .option("--birthday <date>", "YYYY-MM-DD")
  .description("Update profile")
  .action(
    wrapAction(
      async (
        opts: { name?: string; gender?: string; birthday?: string },
        command: Command,
      ) => {
        if (!opts.name && !opts.gender && !opts.birthday) {
          throw new Error("Provide at least one of --name, --gender, --birthday");
        }

        const { api } = await requireApi(command);
        const currentInfo = normalizeAccountInfo(await api.fetchAccountInfo());
        const current = currentInfo.profile;
        const currentSdob = String(current.sdob ?? "");
        const currentDob = Number(current.dob ?? 0);

        let dob = opts.birthday;
        if (!dob) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(currentSdob)) {
            dob = currentSdob;
          } else if (currentDob && Number.isFinite(currentDob)) {
            const ms = currentDob > 10_000_000_000 ? currentDob : currentDob * 1000;
            dob = formatDateOnly(new Date(ms));
          } else {
            dob = "1970-01-01";
          }
        }

        let gender =
          Number(current.gender) === Gender.Female ? Gender.Female : Gender.Male;
        if (opts.gender) {
          const normalized = opts.gender.trim().toLowerCase();
          if (normalized === "male") gender = Gender.Male;
          else if (normalized === "female") gender = Gender.Female;
          else throw new Error('Gender must be "male" or "female"');
        }

        const name =
          opts.name ??
          String(
            current.displayName ?? current.zaloName ?? current.username ?? currentInfo.displayName,
          );

        const response = await api.updateProfile({
          profile: {
            name,
            dob: dob as `${string}-${string}-${string}`,
            gender,
          },
        });
        output(response, false);
      },
    ),
  );

me
  .command("avatar <file>")
  .description("Change profile avatar")
  .action(
    wrapAction(async (file: string, command: Command) => {
      const { api } = await requireApi(command);
      const normalizedFile = normalizeMediaInput(file);
      await assertFilesExist([normalizedFile]);
      output(await api.changeAccountAvatar(normalizedFile), false);
    }),
  );

me
  .command("avatars")
  .option("-j, --json", "JSON output")
  .description("List avatars")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.getAvatarList(), Boolean(opts.json));
    }),
  );

me
  .command("delete-avatar <id>")
  .description("Delete avatar")
  .action(
    wrapAction(async (id: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.deleteAvatar(id), false);
    }),
  );

me
  .command("reuse-avatar <id>")
  .description("Reuse previous avatar")
  .action(
    wrapAction(async (id: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.reuseAvatar(id), false);
    }),
  );

me
  .command("status <status>")
  .description("Set online status (online|offline)")
  .action(
    wrapAction(async (status: string, command: Command) => {
      const normalized = status.trim().toLowerCase();
      if (!["online", "offline"].includes(normalized)) {
        throw new Error('Status must be "online" or "offline"');
      }

      const { api } = await requireApi(command);
      output(await api.updateActiveStatus(normalized === "online"), false);
    }),
  );

me
  .command("last-online <userId>")
  .description("Get last online of a user")
  .action(
    wrapAction(async (userId: string, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.lastOnline(userId), false);
    }),
  );

program
  .command("listen")
  .description("Listen for real-time incoming messages")
  .option("-e, --echo", "Echo incoming text message")
  .option("-p, --prefix <prefix>", "Only process text starting with prefix")
  .option("-w, --webhook <url>", "POST message payload to webhook")
  .option("-r, --raw", "Output JSON line payload")
  .option("--db", "Force DB persistence for this listener session")
  .option("--no-db", "Disable DB persistence for this listener session")
  .option("-k, --keep-alive", "Auto restart listener on disconnect")
  .option(
    "--supervised",
    "Supervisor mode (disable internal retry ownership; emit lifecycle events in --raw)",
  )
  .option(
    "--heartbeat-ms <ms>",
    "Lifecycle heartbeat interval in --supervised mode (default: 30000, 0 disables)",
  )
  .option(
    "--recycle-ms <ms>",
    "Force recycle listener after N ms (or use OPENZCA_LISTEN_RECYCLE_MS)",
  )
  .action(
    wrapAction(
      async (
        opts: {
          echo?: boolean;
          prefix?: string;
          webhook?: string;
          raw?: boolean;
          db?: boolean;
          keepAlive?: boolean;
          supervised?: boolean;
          heartbeatMs?: string;
          recycleMs?: string;
        },
        command: Command,
      ) => {
        const { profile, api } = await requireApi(command);
        const supervised = Boolean(opts.supervised);
        const defaultRecycleMs = 30 * 60 * 1000;
        const recycleMs =
          parseNonNegativeIntOption("--recycle-ms", opts.recycleMs) ??
          parseNonNegativeIntOption(
            "OPENZCA_LISTEN_RECYCLE_MS",
            process.env.OPENZCA_LISTEN_RECYCLE_MS,
          ) ??
          defaultRecycleMs;
        const heartbeatMs =
          parseNonNegativeIntOption("--heartbeat-ms", opts.heartbeatMs) ??
          parseNonNegativeIntOption(
            "OPENZCA_LISTEN_HEARTBEAT_MS",
            process.env.OPENZCA_LISTEN_HEARTBEAT_MS,
          ) ??
          30_000;
        const lifecycleEventsEnabled = supervised && Boolean(opts.raw);
        const recycleEnabled = !supervised && Boolean(opts.keepAlive) && recycleMs > 0;
        const keepAliveRestartDelayMs = parsePositiveIntFromEnv(
          "OPENZCA_LISTEN_KEEPALIVE_RESTART_DELAY_MS",
          2_000,
        );
        const keepAliveRestartOnAnyClose = parseBooleanFromEnv(
          "OPENZCA_LISTEN_KEEPALIVE_RESTART_ON_ANY_CLOSE",
          false,
        );
        const recycleExitCode = 75;
        const includeReplyContext = parseToggleDefaultTrue(
          process.env.OPENZCA_LISTEN_INCLUDE_QUOTE_CONTEXT,
        );
        const downloadQuoteMedia = parseToggleDefaultTrue(
          process.env.OPENZCA_LISTEN_DOWNLOAD_QUOTE_MEDIA,
        );
        const sessionId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
        const selfId = api.getOwnId();
        const dbWriteEnabled = await shouldWriteToDb(profile, getDbWriteOverride(opts));

        const emitLifecycle = (
          event: "session_id" | "connected" | "heartbeat" | "error" | "closed",
          fields?: Record<string, unknown>,
        ): void => {
          if (!lifecycleEventsEnabled) return;
          console.log(
            JSON.stringify({
              kind: "lifecycle",
              event,
              session_id: sessionId,
              profile,
              timestamp: Math.floor(Date.now() / 1000),
              ...fields,
            }),
          );
        };

        const enforceSingleOwner = parseBooleanFromEnv("OPENZCA_LISTEN_ENFORCE_SINGLE_OWNER", true);
        let ownerLock: ListenerOwnerLockHandle | null = null;
        let ipcServer: ListenerIpcServerHandle | null = null;
        let ipcSocketPath: string | undefined;
        let resourcesCleaned = false;

        const cleanupListenResources = async () => {
          if (resourcesCleaned) return;
          resourcesCleaned = true;

          if (ipcServer) {
            await ipcServer.close();
            ipcServer = null;
          }
          if (ownerLock) {
            await ownerLock.release();
            ownerLock = null;
          }
        };

        const unregisterResourceCleanup = registerShutdownCallback(async () => {
          await cleanupListenResources();
        });

        try {
          if (enforceSingleOwner) {
            ownerLock = await acquireListenerOwnerLock(profile, sessionId, command);
            writeDebugLine(
              "listen.owner.acquired",
              {
                profile,
                lockPath: ownerLock.lockPath,
                pid: process.pid,
                sessionId,
              },
              command,
            );
          }

          ipcServer = await startListenerIpcServer(api, profile, sessionId, command);
          ipcSocketPath = ipcServer?.socketPath;

          console.log("Listening... Press Ctrl+C to stop.");
          if (supervised && opts.keepAlive) {
            console.error("Warning: --supervised ignores internal --keep-alive reconnect ownership.");
          }
          writeDebugLine(
            "listen.start",
            {
              profile,
              mediaDir: resolveInboundMediaDir(profile),
              maxMediaBytes: parseMaxInboundMediaBytes(),
              maxMediaFiles: parseMaxInboundMediaFiles(),
              includeMediaUrl: process.env.OPENZCA_LISTEN_INCLUDE_MEDIA_URL?.trim() ?? null,
              keepAlive: Boolean(opts.keepAlive),
              keepAliveRestartDelayMs: Boolean(opts.keepAlive)
                ? keepAliveRestartDelayMs
                : undefined,
              keepAliveRestartOnAnyClose: Boolean(opts.keepAlive)
                ? keepAliveRestartOnAnyClose
                : undefined,
              supervised,
              lifecycleEventsEnabled,
              heartbeatMs: lifecycleEventsEnabled ? heartbeatMs : undefined,
              recycleMs: recycleEnabled ? recycleMs : undefined,
              includeReplyContext,
              downloadQuoteMedia,
              sessionId,
              singleOwner: enforceSingleOwner,
              ipcSocketPath,
            },
            command,
          );
          emitLifecycle("session_id");

          let keepAliveRestartTimer: ReturnType<typeof setTimeout> | null = null;

          async function emitWebhook(payload: Record<string, unknown>): Promise<void> {
            if (!opts.webhook) return;
            try {
              const response = await fetch(opts.webhook, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify(payload),
              });
              if (!response.ok) {
                console.error(`Webhook response: ${response.status}`);
              }
            } catch (error) {
              console.error(
                `Webhook failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          api.listener.on("connected", () => {
            console.log("Connected to Zalo websocket.");
            if (keepAliveRestartTimer) {
              clearTimeout(keepAliveRestartTimer);
              keepAliveRestartTimer = null;
            }
            writeDebugLine(
              "listen.connected",
              {
                profile,
                sessionId,
              },
              command,
            );
            emitLifecycle("connected");
          });

          api.listener.on("message", async (message) => {
          const messageData = message.data as Record<string, unknown>;
          const rawContent = messageData.content;
          const msgType = getStringCandidate(messageData, ["msgType"]);
          let quote = normalizeQuoteContext(messageData.quote);
          const parsedContent = normalizeStructuredContent(rawContent);
          const hasParsedStructuredContent = parsedContent !== rawContent;
          const rawText = typeof rawContent === "string" ? rawContent : "";

          const mediaKind = detectInboundMediaKind(msgType, parsedContent);
          const maxMediaFiles = parseMaxInboundMediaFiles();
          const remoteMediaUrls =
            mediaKind && maxMediaFiles > 0
              ? resolvePreferredMediaUrls(mediaKind, parsedContent).slice(0, maxMediaFiles)
              : [];
          const quoteRemoteMediaUrls =
            quote && downloadQuoteMedia && maxMediaFiles > 0
              ? (quote.mediaUrls ?? []).slice(0, maxMediaFiles)
              : [];
          writeDebugLine(
            "listen.media.detected",
            {
              profile,
              threadId: message.threadId,
              msgType: msgType || undefined,
              mediaKind,
              hasParsedStructuredContent,
              remoteMediaUrls,
              hasQuote: Boolean(quote),
              quoteOwnerId: quote?.ownerId,
              quoteGlobalMsgId: quote?.globalMsgId,
              quoteCliMsgId: quote?.cliMsgId,
              quoteRemoteMediaUrls,
            },
            command,
          );

          const [mediaEntries, quoteMediaEntries] = await Promise.all([
            mediaKind
              ? cacheRemoteMediaEntries({
                  profile,
                  urls: remoteMediaUrls,
                  kind: mediaKind,
                  command,
                  warningLabel: "inbound media",
                  debugErrorEvent: "listen.media.cache_error",
                  debugUrlKey: "mediaUrl",
                })
              : Promise.resolve([]),
            cacheRemoteMediaEntries({
              profile,
              urls: quoteRemoteMediaUrls,
              kind: "file",
              command,
              warningLabel: "quoted media",
              debugErrorEvent: "listen.quote_media.cache_error",
              debugUrlKey: "quoteMediaUrl",
            }),
          ]);

          const localEntries = mediaEntries.filter((entry) => Boolean(entry.mediaPath));
          const mediaPaths = localEntries.map((entry) => entry.mediaPath as string);
          const mediaUrls =
            localEntries.length > 0
              ? localEntries
                  .map((entry) => entry.mediaUrl)
                  .filter((value): value is string => Boolean(value))
              : mediaEntries
                  .map((entry) => entry.mediaUrl)
                  .filter((value): value is string => Boolean(value));
          const mediaTypes =
            localEntries.length > 0
              ? localEntries
                  .map((entry) => entry.mediaType)
                  .filter((value): value is string => Boolean(value))
              : mediaEntries
                  .map((entry) => entry.mediaType)
                  .filter((value): value is string => Boolean(value));

          const mediaPath = mediaPaths[0];
          const mediaUrl = mediaUrls[0];
          const mediaType = mediaTypes[0];

          const quoteLocalEntries = quoteMediaEntries.filter((entry) => Boolean(entry.mediaPath));
          const quoteMediaPaths = quoteLocalEntries.map((entry) => entry.mediaPath as string);
          const quoteMediaUrls =
            quoteLocalEntries.length > 0
              ? quoteLocalEntries
                  .map((entry) => entry.mediaUrl)
                  .filter((value): value is string => Boolean(value))
              : quoteMediaEntries
                  .map((entry) => entry.mediaUrl)
                  .filter((value): value is string => Boolean(value));
          const quoteMediaTypes =
            quoteLocalEntries.length > 0
              ? quoteLocalEntries
                  .map((entry) => entry.mediaType)
                  .filter((value): value is string => Boolean(value))
              : quoteMediaEntries
                  .map((entry) => entry.mediaType)
                  .filter((value): value is string => Boolean(value));
          const quoteMediaPath = quoteMediaPaths[0];
          const quoteMediaUrl = quoteMediaUrls[0];
          const quoteMediaType = quoteMediaTypes[0];

          if (quote) {
            quote = {
              ...quote,
              mediaPath: quoteMediaPath,
              mediaPaths: quoteMediaPaths.length > 0 ? quoteMediaPaths : undefined,
              mediaUrl: quoteMediaUrl,
              mediaUrls: quoteMediaUrls.length > 0 ? quoteMediaUrls : quote.mediaUrls,
              mediaType: quoteMediaType,
              mediaTypes: quoteMediaTypes.length > 0 ? quoteMediaTypes : undefined,
            };
          }
          const replyContextText =
            includeReplyContext && quote ? buildReplyContextText(quote) : "";
          const replyMediaText =
            includeReplyContext && quoteMediaEntries.length > 0
              ? buildReplyMediaAttachedText({ mediaEntries: quoteMediaEntries })
              : "";

          const caption =
            rawText.trim().length > 0 && !hasParsedStructuredContent
              ? rawText.trim()
              : summarizeStructuredContent(msgType, parsedContent);
          let processedText = mediaEntries.length
            ? buildMediaAttachedText({
                mediaEntries,
                fallbackKind: mediaKind,
                caption,
              })
            : rawText.trim().length > 0 && !hasParsedStructuredContent
              ? rawText
              : summarizeStructuredContent(msgType, parsedContent);

          if (!processedText.trim() && !replyContextText && !replyMediaText) return;

          if (opts.prefix && processedText.trim().length > 0) {
            if (!processedText.startsWith(opts.prefix)) return;
            processedText = processedText.slice(opts.prefix.length).trimStart();
          }

          if (replyMediaText) {
            processedText = processedText.trim()
              ? `${processedText}\n${replyMediaText}`
              : replyMediaText;
          }
          if (replyContextText) {
            processedText = processedText.trim()
              ? `${processedText}\n${replyContextText}`
              : replyContextText;
          }

          const chatType = message.type === ThreadType.Group ? "group" : "user";
          const senderId = getStringCandidate(messageData, ["uidFrom"]) || message.data.uidFrom;
          const senderDisplayNameRaw = getStringCandidate(messageData, [
            "dName",
            "fromD",
            "senderName",
            "displayName",
          ]);
          const senderDisplayName = senderDisplayNameRaw || undefined;
          // Keep DM metadata senderName empty so downstream prefers stable numeric ids.
          const senderNameForMetadata = message.type === ThreadType.Group ? senderDisplayName : undefined;
          const toId = getStringCandidate(messageData, ["idTo"]) || undefined;
          const threadName =
            typeof messageData.threadName === "string"
              ? messageData.threadName
              : typeof messageData.tName === "string"
                ? messageData.tName
                : undefined;
          const mentions = extractInboundMentions({
            messageData,
            parsedContent,
            rawText,
          });
          const mentionIds = mentions.map((item) => item.uid);
          const timestamp = toEpochSeconds(message.data.ts);
          const timestampMs = toEpochMs(message.data.ts);

          const payload = {
            threadId: message.threadId,
            targetId: message.threadId,
            conversationId: message.threadId,
            msgId: message.data.msgId,
            cliMsgId: message.data.cliMsgId,
            content: processedText,
            type: message.type,
            timestamp,
            msgType: msgType || undefined,
            quote: quote ?? undefined,
            quoteMediaPath,
            quoteMediaPaths: quoteMediaPaths.length > 0 ? quoteMediaPaths : undefined,
            quoteMediaUrl,
            quoteMediaUrls: quoteMediaUrls.length > 0 ? quoteMediaUrls : undefined,
            quoteMediaType,
            quoteMediaTypes: quoteMediaTypes.length > 0 ? quoteMediaTypes : undefined,
            mediaPath,
            mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
            mediaUrl,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
            mediaType,
            mediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
            mediaKind: mediaKind ?? undefined,
            mentions: mentions.length > 0 ? mentions : undefined,
            mentionIds: mentionIds.length > 0 ? mentionIds : undefined,
            metadata: {
              isGroup: message.type === ThreadType.Group,
              chatType,
              threadId: message.threadId,
              targetId: message.threadId,
              threadName,
              senderName: senderNameForMetadata,
              senderDisplayName,
              senderId,
              fromId: senderId,
              toId,
              msgType: msgType || undefined,
              quote: quote ?? undefined,
              quoteMediaPath,
              quoteMediaPaths: quoteMediaPaths.length > 0 ? quoteMediaPaths : undefined,
              quoteMediaUrl,
              quoteMediaUrls: quoteMediaUrls.length > 0 ? quoteMediaUrls : undefined,
              quoteMediaType,
              quoteMediaTypes: quoteMediaTypes.length > 0 ? quoteMediaTypes : undefined,
              timestamp,
              mediaPath,
              mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
              mediaUrl,
              mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
              mediaType,
              mediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
              mediaKind: mediaKind ?? undefined,
              mentions: mentions.length > 0 ? mentions : undefined,
              mentionIds: mentionIds.length > 0 ? mentionIds : undefined,
              mentionCount: mentions.length > 0 ? mentions.length : undefined,
            },
            // Backward-compatible convenience fields.
            chatType,
            senderId,
            senderName: senderDisplayName,
            senderDisplayName,
            toId,
            ts: message.data.ts,
          };

          if (dbWriteEnabled) {
            const mediaForDb: DbMedia[] = mediaEntries.map((entry) => ({
              mediaKind: mediaKind ?? undefined,
              mediaUrl: entry.mediaUrl,
              mediaPath: entry.mediaPath,
              mediaType: entry.mediaType,
              rawJson: JSON.stringify(entry),
            }));
            const mentionsForDb: DbMention[] = mentions.map((mention) => ({
              uid: mention.uid,
              pos: mention.pos,
              len: mention.len,
              type: mention.type,
              rawJson: JSON.stringify(mention),
            }));
            scheduleDbWrite(profile, command, "listen.db.persist_error", async () => {
              await persistMessage(
                normalizeInboundListenRecord({
                  profile,
                  threadType: chatType,
                  rawThreadId: message.threadId,
                  senderId,
                  senderName: senderDisplayName,
                  toId,
                  selfId,
                  title: threadName,
                  msgId: message.data.msgId,
                  cliMsgId: message.data.cliMsgId,
                  actionId: getStringCandidate(messageData, ["actionId"]),
                  timestampMs,
                  msgType: msgType || undefined,
                  contentText: processedText || rawText || undefined,
                  contentJson:
                    rawContent && typeof rawContent === "object" ? JSON.stringify(rawContent) : undefined,
                  quoteMsgId: quote?.globalMsgId ? String(quote.globalMsgId) : undefined,
                  quoteCliMsgId: quote?.cliMsgId ? String(quote.cliMsgId) : undefined,
                  quoteOwnerId: quote?.ownerId ? String(quote.ownerId) : undefined,
                  quoteText: quote?.msg,
                  media: mediaForDb,
                  mentions: mentionsForDb,
                  rawMessage: message.data,
                  rawPayload: payload,
                  source: "listen",
                }),
              );
            });
          }

          if (opts.raw) {
            console.log(JSON.stringify(payload));
          } else {
            console.log(
              `[${chatType}] ${payload.senderName || payload.senderId} -> ${payload.threadId}: ${payload.content}`,
            );
          }

          await emitWebhook(payload);

          if (opts.echo && rawText.trim().length > 0) {
            try {
              await api.sendMessage(
                { msg: processedText },
                message.threadId,
                message.type,
              );
            } catch (error) {
              console.error(
                `Echo failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          });

          api.listener.on("error", (error) => {
            writeDebugLine(
              "listen.error",
              {
                profile,
                message: error instanceof Error ? error.message : String(error),
                sessionId,
              },
              command,
            );
            emitLifecycle("error", {
              message: error instanceof Error ? error.message : String(error),
            });
            console.error(
              `Listener error: ${error instanceof Error ? error.message : String(error)}`,
            );
          });

          await new Promise<void>((resolve) => {
            let settled = false;
            let recycleTimer: ReturnType<typeof setTimeout> | null = null;
            let recycleForceExitTimer: ReturnType<typeof setTimeout> | null = null;
            let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
            let recyclePendingExit = false;
            let unregisterShutdown = () => {};

            const finish = () => {
              if (settled) return;
              settled = true;
              if (recycleTimer) {
                clearTimeout(recycleTimer);
                recycleTimer = null;
              }
              if (recycleForceExitTimer && !recyclePendingExit) {
                clearTimeout(recycleForceExitTimer);
                recycleForceExitTimer = null;
              }
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
              }
              if (keepAliveRestartTimer) {
                clearTimeout(keepAliveRestartTimer);
                keepAliveRestartTimer = null;
              }
              unregisterShutdown();
              unregisterShutdown = () => {};
              resolve();
            };

            api.listener.on("closed", (code, reason) => {
              console.log(`Listener closed (${code}) ${reason || ""}`);
              writeDebugLine(
                "listen.closed",
                {
                  profile,
                  code,
                  reason: reason || undefined,
                  sessionId,
                },
                command,
              );
              emitLifecycle("closed", {
                code,
                reason: reason || undefined,
              });
              // In keep-alive mode, zca-js handles reconnect internally.
              // For NORMAL_CLOSURE / duplicate connection, enforce restart fallback
              // because server-provided retry code lists can omit those codes.
              if (!opts.keepAlive || supervised) {
                finish();
                return;
              }

              const shouldRestart =
                keepAliveRestartOnAnyClose || code === 1000 || code === 3000;
              if (!shouldRestart) return;

              if (keepAliveRestartTimer) {
                clearTimeout(keepAliveRestartTimer);
              }
              keepAliveRestartTimer = setTimeout(() => {
                keepAliveRestartTimer = null;
                writeDebugLine(
                  "listen.keepalive.restart",
                  {
                    profile,
                    code,
                    reason: reason || undefined,
                    delayMs: keepAliveRestartDelayMs,
                    sessionId,
                  },
                  command,
                );
                try {
                  api.listener.start({ retryOnClose: true });
                } catch (error) {
                  if (!isListenerAlreadyStarted(error)) {
                    writeDebugLine(
                      "listen.keepalive.restart_error",
                      {
                        profile,
                        code,
                        reason: reason || undefined,
                        delayMs: keepAliveRestartDelayMs,
                        message: toErrorText(error),
                        sessionId,
                      },
                      command,
                    );
                  }
                }
              }, keepAliveRestartDelayMs);
            });

          const onSignal = () => {
            try {
              api.listener.stop();
            } catch {
              // ignore
            }
            finish();
          };

          unregisterShutdown = registerShutdownCallback(onSignal);

          if (lifecycleEventsEnabled && heartbeatMs > 0) {
            heartbeatTimer = setInterval(() => {
              emitLifecycle("heartbeat");
            }, heartbeatMs);
          }

          if (recycleEnabled) {
            recycleTimer = setTimeout(() => {
              console.error(
                `Listener recycle triggered after ${recycleMs}ms to prevent stale session.`,
              );
              writeDebugLine(
                "listen.recycle",
                {
                  profile,
                  recycleMs,
                  exitCode: recycleExitCode,
                  sessionId,
                },
                command,
              );

              // Exit non-zero so an external supervisor (e.g. OpenClaw Gateway)
              // can restart this listener process reliably.
              process.exitCode = recycleExitCode;
              recyclePendingExit = true;
              recycleForceExitTimer = setTimeout(() => {
                recycleForceExitTimer = null;
                process.exit(recycleExitCode);
              }, 3000);
              recycleForceExitTimer.unref();

              try {
                api.listener.stop();
              } catch {
                // ignore
              }
              finish();
            }, recycleMs);
          }

            api.listener.start({ retryOnClose: supervised ? false : Boolean(opts.keepAlive) });
          });
        } finally {
          unregisterResourceCleanup();
          await cleanupListenResources();
        }
      },
    ),
  );

program.parseAsync(process.argv);
