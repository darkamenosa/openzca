export interface ProfileMeta {
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfilesDb {
  defaultProfile: string;
  profiles: Record<string, ProfileMeta>;
}

export interface StoredCredentials {
  imei: string;
  cookie: unknown;
  userAgent: string;
  language?: string;
}

export interface ProfileCachePayload {
  friends: unknown[];
  groups: unknown[];
  updatedAt: string;
}

