import { safeStorage } from "electron";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BackendClient } from "./backend";
export async function desktopConnection(
  directory: string,
  fallback: { token?: string; url?: string } = {},
) {
  const file = join(directory, "backend-connection.json");
  let saved: { version: number; url: string; tokenCipher: string } | undefined;
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (
      value.version === 1 &&
      typeof value.url === "string" &&
      typeof value.tokenCipher === "string"
    )
      saved = value;
  } catch {
    /* First launch has no saved connection. */
  }
  const tokenFromEnvironment = fallback.token?.trim();
  let token = tokenFromEnvironment;
  if (!token && saved && safeStorage.isEncryptionAvailable()) {
    try {
      token = safeStorage.decryptString(
        Buffer.from(saved.tokenCipher, "base64"),
      );
    } catch {
      console.warn(
        "Saved backend connection could not be decrypted. Run the local launcher to reconnect.",
      );
    }
  }
  const url = fallback.url ?? saved?.url ?? "http://127.0.0.1:4317/";
  const api = new BackendClient(url, token);
  if (tokenFromEnvironment && safeStorage.isEncryptionAvailable()) {
    const data = {
      version: 1,
      url,
      tokenCipher: safeStorage
        .encryptString(tokenFromEnvironment)
        .toString("base64"),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(data), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  }
  return api;
}
