#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
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
  LICENSE_FILE,
  PROFILES_FILE,
  addProfile,
  clearCache,
  clearCredentials,
  clearLicense,
  ensureProfile,
  getCredentialsPath,
  listProfiles,
  loadCredentials,
  loadLicense,
  readCache,
  removeProfile,
  resolveProfileName,
  saveLicense,
  setDefaultProfile,
  setProfileLabel,
  writeCache,
} from "./lib/store.js";
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
  normalizeInputList,
} from "./lib/media.js";

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

function wrapAction<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

async function currentProfile(_command?: Command): Promise<string> {
  const opts = program.opts() as { profile?: string };
  return resolveProfileName(opts.profile);
}

async function requireApi(command?: Command): Promise<{ profile: string; api: API }> {
  const profile = await currentProfile(command);
  const api = await loginWithStoredCredentials(profile);
  return { profile, api };
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

function makeDeviceFingerprint(): string {
  const network = os.networkInterfaces();
  const flattenedMacs = Object.values(network)
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.mac)
    .filter((mac) => mac && mac !== "00:00:00:00:00:00")
    .sort();

  const raw = JSON.stringify({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().map((cpu) => cpu.model),
    totalmem: os.totalmem(),
    macs: flattenedMacs,
  });

  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12).toUpperCase();
}

function makeSupportCode(fingerprint: string): string {
  return `ZCA-${fingerprint.slice(0, 4)}-${fingerprint.slice(4, 8)}-${fingerprint.slice(8, 12)}`;
}

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function askConfirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${message} (y/N): `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
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

program
  .name("openzca")
  .description("Open-source zca-cli compatible wrapper powered by zca-js")
  .version("0.1.0")
  .option("-p, --profile <name>", "Profile name")
  .showHelpAfterError();

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
  .option("--qr-path <path>", "Save QR image path")
  .action(
    wrapAction(async (opts: { qrPath?: string }, command: Command) => {
      const profile = await currentProfile(command);
      await ensureProfile(profile);

      const { api } = await loginWithQrAndPersist(profile, opts.qrPath);
      const me = await api.fetchAccountInfo();

      console.log(`Logged in profile ${profile} as ${me.displayName} (${me.userId})`);

      const cache = await refreshCacheForProfile(profile, api);
      console.log(
        `Cache refreshed: ${cache.friends} friends, ${cache.groups} groups`,
      );
    }),
  );

auth
  .command("login-cred [file]")
  .alias("login-creds")
  .description("Login using credential JSON file")
  .action(
    wrapAction(async (file = "credentials.json", command: Command) => {
      const profile = await currentProfile(command);
      const credentials = await parseCredentialFile(path.resolve(file));
      const api = await loginWithCredentialPayload(profile, credentials);
      const me = await api.fetchAccountInfo();
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
        console.log(`Profile ${profile}: not logged in`);
        return;
      }

      const api = await createZaloClient().login(toCredentials(credentials));
      const me = await api.fetchAccountInfo();

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

const msg = program.command("msg").description("Messaging commands");

msg
  .command("send <threadId> <message>")
  .option("--group", "Send to group")
  .description("Send text message")
  .action(
    wrapAction(async (threadId: string, message: string, opts: { group?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.sendMessage(message, threadId, asThreadType(opts.group));
      output(response, false);
    }),
  );

msg
  .command("image <threadId> [file]")
  .option("-u, --url <url>", "Image URL (repeatable)", collectValues, [] as string[])
  .option("-m, --message <message>", "Caption")
  .option("--group", "Send to group")
  .description("Send image(s) from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; message?: string; group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);

        const files = [file, ...normalizeInputList(opts.url)].filter(Boolean) as string[];
        const urlInputs = files.filter((entry) => /^https?:\/\//i.test(entry));
        const localInputs = files.filter((entry) => !/^https?:\/\//i.test(entry));

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
  .option("--thumbnail <url>", "Thumbnail URL (kept for compatibility)")
  .option("--group", "Send to group")
  .description("Send video(s) from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; message?: string; group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);

        const files = [file, ...normalizeInputList(opts.url)].filter(Boolean) as string[];
        const urlInputs = files.filter((entry) => /^https?:\/\//i.test(entry));
        const localInputs = files.filter((entry) => !/^https?:\/\//i.test(entry));

        const downloaded = await downloadUrlsToTempFiles(urlInputs);
        try {
          const attachments = [...localInputs, ...downloaded.files];
          if (attachments.length === 0) {
            throw new Error("Provide at least one video file or --url.");
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
        } finally {
          await downloaded.cleanup();
        }
      },
    ),
  );

msg
  .command("voice <threadId> [file]")
  .option("-u, --url <url>", "Voice URL (repeatable)", collectValues, [] as string[])
  .option("--group", "Send to group")
  .description("Send voice message from file or URL")
  .action(
    wrapAction(
      async (
        threadId: string,
        file: string | undefined,
        opts: { url?: string[]; group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const type = asThreadType(opts.group);

        const urls = normalizeInputList(opts.url);
        const localFiles = [file].filter(Boolean) as string[];

        if (urls.length === 0 && localFiles.length === 0) {
          throw new Error("Provide a voice file or --url.");
        }

        const results: unknown[] = [];

        for (const voiceUrl of urls) {
          results.push(await api.sendVoice({ voiceUrl }, threadId, type));
        }

        if (localFiles.length > 0) {
          await assertFilesExist(localFiles);
          const uploaded = await api.uploadAttachment(localFiles, threadId, type);
          for (const item of uploaded) {
            if (item.fileType === "others" || item.fileType === "video") {
              results.push(await api.sendVoice({ voiceUrl: item.fileUrl }, threadId, type));
            }
          }
        }

        output(results, false);
      },
    ),
  );

msg
  .command("sticker <threadId> <stickerId>")
  .option("--group", "Send to group")
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
  .option("--group", "Send to group")
  .description("Send link")
  .action(
    wrapAction(async (threadId: string, url: string, opts: { group?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const response = await api.sendLink({ link: url }, threadId, asThreadType(opts.group));
      output(response, false);
    }),
  );

msg
  .command("card <threadId> <contactId>")
  .option("--group", "Send to group")
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
  .option("--group", "React in group")
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
  .option("--group", "Typing in group")
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
  .option("--group", "Forward to groups")
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
  .option("--group", "Delete in group")
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
  .option("--group", "Undo in group")
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
  .command("upload <arg1> [arg2]")
  .option("-u, --url <url>", "File URL (repeatable)", collectValues, [] as string[])
  .option("--group", "Upload in group")
  .description("Upload and send file(s)")
  .action(
    wrapAction(
      async (
        arg1: string,
        arg2: string | undefined,
        opts: { url?: string[]; group?: boolean },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        const urls = normalizeInputList(opts.url);

        const [threadId, file] = arg2 ? [arg2, arg1] : [arg1, undefined];
        const localFiles = [file].filter(Boolean) as string[];

        const downloaded = await downloadUrlsToTempFiles(urls);
        try {
          const attachments = [...localFiles, ...downloaded.files];
          if (attachments.length === 0) {
            throw new Error(
              "Provide file and threadId (upload <file> <threadId>) or use --url.",
            );
          }
          await assertFilesExist(attachments);

          const response = await api.sendMessage(
            {
              msg: "",
              attachments,
            },
            threadId,
            asThreadType(opts.group),
          );
          output(response, false);
        } finally {
          await downloaded.cleanup();
        }
      },
    ),
  );

const group = program.command("group").description("Group management");

group
  .command("list")
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
  .description("List group members")
  .action(
    wrapAction(async (groupId: string, opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const info = await api.getGroupInfo(groupId);
      const groupInfo = info.gridInfoMap[groupId];
      if (!groupInfo) {
        throw new Error(`Group not found: ${groupId}`);
      }

      const ids = groupInfo.memberIds ?? [];
      const profiles = ids.length > 0 ? await api.getGroupMembersInfo(ids) : { profiles: {} };
      const profileMap = profiles.profiles as Record<
        string,
        { displayName?: string; zaloName?: string }
      >;

      if (opts.json) {
        output({ group: groupInfo, profiles: profiles.profiles }, true);
        return;
      }

      const rows = ids.map((id) => ({
        userId: id,
        displayName: profileMap[id]?.displayName ?? "",
        zaloName: profileMap[id]?.zaloName ?? "",
      }));
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
      await assertFilesExist([file]);
      const response = await api.changeGroupAvatar(file, groupId);
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
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
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

      output(result, Boolean(opts.json));
    }),
  );

friend
  .command("online")
  .option("--json", "JSON output")
  .description("List online friends")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      const data = await api.getFriendOnlines();
      output(data.onlines, Boolean(opts.json));
    }),
  );

friend
  .command("recommendations")
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
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
  .option("--json", "JSON output")
  .description("Get account info")
  .action(
    wrapAction(async (opts: { json?: boolean }, command: Command) => {
      const { api } = await requireApi(command);
      output(await api.fetchAccountInfo(), Boolean(opts.json));
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
        const current = await api.fetchAccountInfo();

        let dob = opts.birthday;
        if (!dob) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(current.sdob || "")) {
            dob = current.sdob;
          } else if (current.dob && Number.isFinite(current.dob)) {
            const ms = current.dob > 10_000_000_000 ? current.dob : current.dob * 1000;
            dob = formatDateOnly(new Date(ms));
          } else {
            dob = "1970-01-01";
          }
        }

        let gender = current.gender;
        if (opts.gender) {
          const normalized = opts.gender.trim().toLowerCase();
          if (normalized === "male") gender = Gender.Male;
          else if (normalized === "female") gender = Gender.Female;
          else throw new Error('Gender must be "male" or "female"');
        }

        const name = opts.name ?? current.displayName ?? current.zaloName;

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
      await assertFilesExist([file]);
      output(await api.changeAccountAvatar(file), false);
    }),
  );

me
  .command("avatars")
  .option("--json", "JSON output")
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
  .option("--echo", "Echo incoming text message")
  .option("--prefix <prefix>", "Only process text starting with prefix")
  .option("--webhook <url>", "POST message payload to webhook")
  .option("--raw", "Output JSON line payload")
  .option("--keep-alive", "Auto restart listener on disconnect")
  .action(
    wrapAction(
      async (
        opts: {
          echo?: boolean;
          prefix?: string;
          webhook?: string;
          raw?: boolean;
          keepAlive?: boolean;
        },
        command: Command,
      ) => {
        const { api } = await requireApi(command);
        console.log("Listening... Press Ctrl+C to stop.");

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
        });

        api.listener.on("message", async (message) => {
          const content = message.data.content;
          const text = typeof content === "string" ? content : null;
          if (!text) return;

          let processedText = text;
          if (opts.prefix) {
            if (!processedText.startsWith(opts.prefix)) return;
            processedText = processedText.slice(opts.prefix.length).trimStart();
          }

          const payload = {
            type: message.type === ThreadType.Group ? "group" : "user",
            threadId: message.threadId,
            senderId: message.data.uidFrom,
            senderName: message.data.dName,
            msgId: message.data.msgId,
            cliMsgId: message.data.cliMsgId,
            content: processedText,
            ts: message.data.ts,
          };

          if (opts.raw) {
            console.log(JSON.stringify(payload));
          } else {
            console.log(
              `[${payload.type}] ${payload.senderName || payload.senderId} -> ${payload.threadId}: ${payload.content}`,
            );
          }

          await emitWebhook(payload);

          if (opts.echo) {
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
          console.error(
            `Listener error: ${error instanceof Error ? error.message : String(error)}`,
          );
        });

        await new Promise<void>((resolve) => {
          api.listener.on("closed", (code, reason) => {
            console.log(`Listener closed (${code}) ${reason || ""}`);
            resolve();
          });

          const onSigint = () => {
            api.listener.stop();
            resolve();
          };

          process.once("SIGINT", onSigint);
          api.listener.start({ retryOnClose: Boolean(opts.keepAlive) });
        });
      },
    ),
  );

const license = program.command("license").description("License commands");

license
  .command("support-code")
  .description("Show device support code")
  .action(
    wrapAction(async () => {
      const fingerprint = makeDeviceFingerprint();
      console.log(makeSupportCode(fingerprint));
    }),
  );

license
  .command("me-id")
  .description("Show your Zalo user ID (for account-based license)")
  .action(
    wrapAction(async (command: Command) => {
      const { api } = await requireApi(command);
      console.log(api.getOwnId());
    }),
  );

license
  .command("activate <key>")
  .description("Activate local license key")
  .action(
    wrapAction(async (key: string) => {
      const fingerprint = makeDeviceFingerprint();
      const supportCode = makeSupportCode(fingerprint);

      await saveLicense({
        key,
        activatedAt: new Date().toISOString(),
        supportCode,
        deviceFingerprint: fingerprint,
      });

      console.log("License activated.");
      console.log(`Support code: ${supportCode}`);
    }),
  );

license
  .command("status")
  .description("Show local license status")
  .action(
    wrapAction(async () => {
      const data = await loadLicense();
      if (!data) {
        output(
          {
            active: false,
            file: LICENSE_FILE,
          },
          false,
        );
        return;
      }

      output(
        {
          active: true,
          key: maskKey(data.key),
          activatedAt: data.activatedAt,
          supportCode: data.supportCode,
          file: LICENSE_FILE,
        },
        false,
      );
    }),
  );

license
  .command("deactivate")
  .option("--force", "Skip confirmation")
  .description("Deactivate local license")
  .action(
    wrapAction(async (opts: { force?: boolean }) => {
      if (!opts.force) {
        const confirmed = await askConfirm("Deactivate license?");
        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }
      }

      await clearLicense();
      console.log("License deactivated.");
    }),
  );

program.parseAsync(process.argv);
