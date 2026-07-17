/**
 * credentials-store.ts
 *
 * Persists Google OAuth Client ID + Secret encrypted via safeStorage.
 * File: userData/google-oauth.enc (Buffer stored as hex string for portability)
 */

import fs from "fs/promises";
import path from "path";
import { app, safeStorage } from "@glaze/core/backend";

interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Google OAuth Web client baked into the app, so it works out of the box with
 * no manual setup. A credential the user enters in Settings → Google OAuth
 * still takes precedence (see getCredentials).
 */
const EMBEDDED_CREDENTIALS: GoogleCredentials = {
  clientId: "701744856350-1k2teu82v81d23qeus1vii4g0v236vgr.apps.googleusercontent.com",
  clientSecret: "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",
};

async function getCredentialsPath(): Promise<string> {
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  return path.join(userDataPath, "google-oauth.enc");
}

export async function getCredentials(): Promise<GoogleCredentials> {
  try {
    const credPath = await getCredentialsPath();
    const hexData = await fs.readFile(credPath, "utf-8");
    const encrypted = Buffer.from(hexData.trim(), "hex");
    const json = await safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(json) as GoogleCredentials;
    const clientId = parsed.clientId ?? "";
    const clientSecret = parsed.clientSecret ?? "";
    // A complete user-entered credential wins; otherwise fall back to embedded.
    if (clientId && clientSecret) return { clientId, clientSecret };
    return { ...EMBEDDED_CREDENTIALS };
  } catch {
    return { ...EMBEDDED_CREDENTIALS };
  }
}

export async function setCredentials(credentials: GoogleCredentials): Promise<void> {
  const credPath = await getCredentialsPath();
  const json = JSON.stringify(credentials);
  const encrypted = await safeStorage.encryptString(json);
  await fs.writeFile(credPath, encrypted.toString("hex"), "utf-8");
}

export async function hasCredentials(): Promise<boolean> {
  const { clientId, clientSecret } = await getCredentials();
  return clientId.length > 0 && clientSecret.length > 0;
}
