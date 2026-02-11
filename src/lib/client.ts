import fs from "node:fs/promises";
import path from "node:path";
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

function renderInlineQrPngIfSupported(
  pngBase64: string,
  filePath: string,
): boolean {
  if (!process.stdout.isTTY) return false;

  try {
    const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
    const term = (process.env.TERM ?? "").toLowerCase();
    const renderMode = (process.env.OPENZCA_QR_RENDER ?? "auto").toLowerCase();
    const debug = process.env.OPENZCA_QR_DEBUG === "1";

    const shouldTryKitty =
      renderMode === "kitty" ||
      (renderMode === "auto" &&
        (term.includes("ghostty") ||
          term.includes("kitty") ||
          termProgram.includes("ghostty") ||
          termProgram.includes("wezterm")));
    const shouldTryIterm =
      renderMode === "iterm" ||
      (renderMode === "auto" &&
        termProgram === "iterm.app" &&
        process.env.OPENZCA_QR_DISABLE_ITERM_INLINE !== "1");

    // Ghostty/kitty/wezterm: kitty graphics protocol (chunked PNG payload).
    // This renders the exact qr.png bytes and is generally supported by these terminals.
    if (shouldTryKitty) {
      if (debug) console.error("[openzca] QR render mode: kitty");
      const payload = pngBase64.replace(/\s+/g, "");
      if (payload.length === 0) return false;
      const chunkSize = 1024;
      for (let start = 0; start < payload.length; start += chunkSize) {
        const chunk = payload.slice(start, start + chunkSize);
        const hasMore = start + chunkSize < payload.length ? 1 : 0;
        const metadata = start === 0 ? "a=T,f=100," : "";
        const apc = `\u001B_G${metadata}m=${hasMore};${chunk}\u001B\\`;
        process.stdout.write(apc);
      }
      process.stdout.write("\n");
      return true;
    }

    // iTerm2 inline images (enabled by default on iTerm).
    // Set OPENZCA_QR_DISABLE_ITERM_INLINE=1 to force ASCII fallback.
    if (shouldTryIterm) {
      if (debug) console.error("[openzca] QR render mode: iterm");
      const widthEnv = Number.parseInt(process.env.OPENZCA_QR_WIDTH ?? "", 10);
      const widthCells =
        Number.isFinite(widthEnv) && widthEnv >= 16 && widthEnv <= 80
          ? widthEnv
          : 34;
      const encodedName = Buffer.from(path.basename(filePath)).toString("base64");
      const osc1337 = `\u001B]1337;File=name=${encodedName};inline=1;width=${widthCells};preserveAspectRatio=1:${pngBase64}\u0007`;
      process.stdout.write(`${osc1337}\n`);
      return true;
    }

    if (debug) {
      console.error(
        `[openzca] QR render mode: ascii (TERM_PROGRAM=${termProgram || "-"}, TERM=${term || "-"}, OPENZCA_QR_RENDER=${renderMode})`,
      );
    }
    return false;
  } catch {
    return false;
  }
}

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
        console.log("\nScan this QR in your Zalo app:\n");
        const targetPath = qrPath ?? "qr.png";
        await event.actions.saveToFile(targetPath);
        const rendered = renderInlineQrPngIfSupported(
          event.data.image,
          targetPath,
        );
        if (!rendered) {
          console.log(
            `This terminal does not support inline QR rendering. Open and scan: ${path.resolve(targetPath)}`,
          );
        }
        console.log(`QR code saved to: ${targetPath}`);
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
