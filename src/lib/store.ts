import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LicenseDb, ProfileCachePayload, ProfilesDb, StoredCredentials } from "./types.js";

const PROFILE_NAME_RE = /^[A-Za-z0-9_-]+$/;

export const APP_HOME =
  process.env.OPENZCA_HOME && process.env.OPENZCA_HOME.trim().length > 0
    ? process.env.OPENZCA_HOME
    : path.join(os.homedir(), ".openzca");

export const PROFILES_FILE = path.join(APP_HOME, "profiles.json");
export const LICENSE_FILE = path.join(APP_HOME, "license.json");

const DEFAULT_PROFILE = "default";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function assertProfileName(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error(
      "Invalid profile name. Use only letters, numbers, dashes, and underscores.",
    );
  }
}

export function getProfileDir(name: string): string {
  return path.join(APP_HOME, "profiles", name);
}

export function getCredentialsPath(name: string): string {
  return path.join(getProfileDir(name), "credentials.json");
}

export function getCacheDir(name: string): string {
  return path.join(getProfileDir(name), "cache");
}

export function getFriendsCachePath(name: string): string {
  return path.join(getCacheDir(name), "friends.json");
}

export function getGroupsCachePath(name: string): string {
  return path.join(getCacheDir(name), "groups.json");
}

export function getCacheMetaPath(name: string): string {
  return path.join(getCacheDir(name), "meta.json");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) return null;
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function ensureProfilesDb(): Promise<ProfilesDb> {
  await ensureDir(APP_HOME);

  const current = await readJsonFile<ProfilesDb>(PROFILES_FILE);
  if (current && current.profiles && current.defaultProfile) {
    return current;
  }

  const seed: ProfilesDb = {
    defaultProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: {
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    },
  };

  await writeJsonFile(PROFILES_FILE, seed);
  await ensureDir(getProfileDir(DEFAULT_PROFILE));
  return seed;
}

async function saveProfilesDb(db: ProfilesDb): Promise<void> {
  await writeJsonFile(PROFILES_FILE, db);
}

export async function listProfiles(): Promise<ProfilesDb> {
  return ensureProfilesDb();
}

export async function ensureProfile(name: string): Promise<void> {
  assertProfileName(name);

  const db = await ensureProfilesDb();
  if (!db.profiles[name]) {
    db.profiles[name] = {
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await saveProfilesDb(db);
  }
  await ensureDir(getProfileDir(name));
}

export async function addProfile(name: string): Promise<void> {
  assertProfileName(name);

  const db = await ensureProfilesDb();
  if (db.profiles[name]) {
    throw new Error(`Profile \"${name}\" already exists.`);
  }

  db.profiles[name] = {
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveProfilesDb(db);
  await ensureDir(getProfileDir(name));
}

export async function setDefaultProfile(name: string): Promise<void> {
  const db = await ensureProfilesDb();
  if (!db.profiles[name]) {
    throw new Error(`Profile \"${name}\" does not exist.`);
  }
  db.defaultProfile = name;
  db.profiles[name].updatedAt = nowIso();
  await saveProfilesDb(db);
}

export async function setProfileLabel(name: string, label: string): Promise<void> {
  const db = await ensureProfilesDb();
  if (!db.profiles[name]) {
    throw new Error(`Profile \"${name}\" does not exist.`);
  }

  db.profiles[name].label = label;
  db.profiles[name].updatedAt = nowIso();
  await saveProfilesDb(db);
}

export async function removeProfile(name: string): Promise<void> {
  const db = await ensureProfilesDb();
  if (!db.profiles[name]) {
    throw new Error(`Profile \"${name}\" does not exist.`);
  }

  delete db.profiles[name];

  const profileNames = Object.keys(db.profiles);
  if (profileNames.length === 0) {
    db.profiles[DEFAULT_PROFILE] = {
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.defaultProfile = DEFAULT_PROFILE;
    await ensureDir(getProfileDir(DEFAULT_PROFILE));
  } else if (!db.profiles[db.defaultProfile]) {
    db.defaultProfile = profileNames[0];
  }

  await saveProfilesDb(db);
  await fs.rm(getProfileDir(name), { recursive: true, force: true });
}

export async function resolveProfileName(flagProfile?: string): Promise<string> {
  const db = await ensureProfilesDb();

  const picked =
    (flagProfile && flagProfile.trim()) ||
    (process.env.ZCA_PROFILE && process.env.ZCA_PROFILE.trim()) ||
    db.defaultProfile ||
    DEFAULT_PROFILE;

  if (!db.profiles[picked]) {
    if (picked === DEFAULT_PROFILE) {
      await ensureProfile(DEFAULT_PROFILE);
      return DEFAULT_PROFILE;
    }
    throw new Error(
      `Profile \"${picked}\" does not exist. Create it with: account add ${picked}`,
    );
  }

  return picked;
}

export async function loadCredentials(
  profileName: string,
): Promise<StoredCredentials | null> {
  return readJsonFile<StoredCredentials>(getCredentialsPath(profileName));
}

export async function saveCredentials(
  profileName: string,
  credentials: StoredCredentials,
): Promise<void> {
  await ensureProfile(profileName);
  await writeJsonFile(getCredentialsPath(profileName), credentials);
}

export async function clearCredentials(profileName: string): Promise<void> {
  await fs.rm(getCredentialsPath(profileName), { force: true });
}

export async function writeCache(
  profileName: string,
  payload: ProfileCachePayload,
): Promise<void> {
  await ensureProfile(profileName);
  await ensureDir(getCacheDir(profileName));
  await writeJsonFile(getFriendsCachePath(profileName), payload.friends);
  await writeJsonFile(getGroupsCachePath(profileName), payload.groups);
  await writeJsonFile(getCacheMetaPath(profileName), { updatedAt: payload.updatedAt });
}

export async function readCache(profileName: string): Promise<{
  friends: unknown[];
  groups: unknown[];
  updatedAt: string | null;
}> {
  const friends =
    (await readJsonFile<unknown[]>(getFriendsCachePath(profileName))) ?? [];
  const groups = (await readJsonFile<unknown[]>(getGroupsCachePath(profileName))) ?? [];
  const meta =
    (await readJsonFile<{ updatedAt?: string }>(getCacheMetaPath(profileName))) ?? null;

  return {
    friends,
    groups,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export async function clearCache(profileName: string): Promise<void> {
  await fs.rm(getFriendsCachePath(profileName), { force: true });
  await fs.rm(getGroupsCachePath(profileName), { force: true });
  await fs.rm(getCacheMetaPath(profileName), { force: true });
}

export async function loadLicense(): Promise<LicenseDb | null> {
  return readJsonFile<LicenseDb>(LICENSE_FILE);
}

export async function saveLicense(data: LicenseDb): Promise<void> {
  await writeJsonFile(LICENSE_FILE, data);
}

export async function clearLicense(): Promise<void> {
  await fs.rm(LICENSE_FILE, { force: true });
}
