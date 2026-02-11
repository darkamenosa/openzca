import fs from "node:fs/promises";
import { imageSize } from "image-size";
import {
  LoginQRCallbackEventType,
  type API,
  type Credentials,
  type LoginQRCallback,
  Zalo,
} from "zca-js";
import { loadCredentials, saveCredentials } from "./store.js";
import type { StoredCredentials } from "./types.js";

async function imageMetadataGetter(filePath: string): Promise<{
  width: number;
  height: number;
  size: number;
}> {
  const data = await fs.readFile(filePath);
  const info = imageSize(data);

  if (!info.width || !info.height) {
    throw new Error(`Cannot read image size: ${filePath}`);
  }

  return {
    width: info.width,
    height: info.height,
    size: data.length,
  };
}

export function createZaloClient(): Zalo {
  return new Zalo({
    imageMetadataGetter,
    logging: false,
  });
}

export function toCredentials(
  value: StoredCredentials | Credentials,
): Credentials {
  return {
    imei: value.imei,
    cookie: value.cookie as Credentials["cookie"],
    userAgent: value.userAgent,
    language: value.language,
  };
}

export async function loginWithStoredCredentials(
  profileName: string,
): Promise<API> {
  const stored = await loadCredentials(profileName);
  if (!stored) {
    throw new Error(
      `Profile \"${profileName}\" has no credentials. Run: auth login`,
    );
  }

  const zalo = createZaloClient();
  return zalo.login(toCredentials(stored));
}

export async function loginWithCredentialPayload(
  profileName: string,
  credentials: Credentials,
): Promise<API> {
  const zalo = createZaloClient();
  const api = await zalo.login(credentials);
  await saveCredentials(profileName, {
    imei: credentials.imei,
    cookie: credentials.cookie,
    userAgent: credentials.userAgent,
    language: credentials.language,
  });
  return api;
}

export async function loginWithQrAndPersist(
  profileName: string,
  qrPath?: string,
): Promise<{ api: API; credentials: Credentials }> {
  const zalo = createZaloClient();
  let captured: Credentials | null = null;

  const callback: LoginQRCallback = async (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated: {
        await event.actions.saveToFile(qrPath ?? "qr.png");
        console.log(`QR code saved to: ${qrPath ?? "qr.png"}`);
        break;
      }
      case LoginQRCallbackEventType.QRCodeScanned: {
        console.log(`Scanned by: ${event.data.display_name}`);
        break;
      }
      case LoginQRCallbackEventType.QRCodeDeclined: {
        console.log("QR login declined on phone. Retry by running auth login again.");
        break;
      }
      case LoginQRCallbackEventType.QRCodeExpired: {
        console.log("QR expired. Retrying...");
        break;
      }
      case LoginQRCallbackEventType.GotLoginInfo: {
        captured = {
          imei: event.data.imei,
          cookie: event.data.cookie,
          userAgent: event.data.userAgent,
        };
        break;
      }
      default: {
        break;
      }
    }
  };

  const api = await zalo.loginQR({ qrPath }, callback);

  if (!captured) {
    const ctx = api.getContext();
    const cookieJar = api.getCookie();
    if (!cookieJar) {
      throw new Error("Cannot extract cookie jar from API context.");
    }
    const cookieJson = cookieJar.toJSON();
    captured = {
      imei: ctx.imei,
      cookie: cookieJson?.cookies ?? [],
      userAgent: ctx.userAgent,
      language: ctx.language,
    };
  }

  await saveCredentials(profileName, {
    imei: captured.imei,
    cookie: captured.cookie,
    userAgent: captured.userAgent,
    language: captured.language,
  });

  return { api, credentials: captured };
}
