/**
 * The desktop's Platform for @otter-mail/core: the mail backend runs in this
 * (Electron main) process, with its data in the state directory (paths.ts),
 * secrets in safeStorage, and macOS for dialogs, notifications and the Dock.
 */

import { app, dialog, Notification, powerMonitor, safeStorage, shell } from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AsyncContext, Platform, SqlDatabase } from "@otter-mail/core";

import { broadcast } from "./ipc.js";
import { logger } from "./logger.js";
import { googleAuth } from "./services/gmail-oauth.js";
import { appleTranslator } from "./services/translator.js";
import { refreshTray } from "./services/tray.js";
import { focusMainWindow } from "./windows/main-window.js";

const home = () => app.getPath("userData");

/** Writes through a temp file, so a crash never leaves half a file. */
async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

const SECRETS_FILE = "secrets.json";

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(path.join(home(), SECRETS_FILE), "utf-8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  ics: "text/calendar",
  zip: "application/zip",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "attachment";
}

/**
 * Writes `bytes` to a temp file named `name` (reused while its content is
 * the same) and returns its path: what Preview and Finder drags need.
 */
export async function tempFile(name: string, bytes: Uint8Array): Promise<string> {
  const key = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const file = path.join(app.getPath("temp"), "otter-mail-files", key, sanitizeFilename(name));
  const existing = await fs.stat(file).catch(() => null);
  if (!existing || existing.size !== bytes.length) await writeFileAtomic(file, bytes);
  return file;
}

/** The Mac's name as the user set it ("Chris's MacBook Pro"). */
function computerName(): string {
  try {
    return execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
  } catch {
    return os.hostname().replace(/\.local$/, "");
  }
}

function openDatabase(): SqlDatabase {
  const db = new DatabaseSync(path.join(home(), "mail-cache.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  return db as unknown as SqlDatabase;
}

export function desktopPlatform(): Platform {
  let database: SqlDatabase | null = null;
  return {
    kind: "desktop",
    appVersion: app.getVersion(),
    log: (level, scope, message, data) => logger[level](scope, message, data),

    database: () => (database ??= openDatabase()),
    files: {
      async read(file) {
        try {
          return new Uint8Array(await fs.readFile(path.join(home(), file)));
        } catch {
          return null;
        }
      },
      write: (file, data) => writeFileAtomic(path.join(home(), file), data),
      remove: (file) => fs.rm(path.join(home(), file), { force: true }),
      async list(dir) {
        const full = path.join(home(), dir);
        const names = await fs.readdir(full).catch(() => [] as string[]);
        const files = await Promise.all(
          names.map(async (name) => {
            const stat = await fs.stat(path.join(full, name)).catch(() => null);
            return stat?.isFile() ? { name, size: stat.size, modifiedAt: stat.mtimeMs } : null;
          }),
        );
        return files.filter((f) => f !== null);
      },
    },
    secrets: {
      async get(name) {
        const sealed = (await readSecrets())[name];
        return sealed ? safeStorage.decryptString(Buffer.from(sealed, "base64")) : null;
      },
      async set(name, value) {
        const secrets = await readSecrets();
        secrets[name] = safeStorage.encryptString(value).toString("base64");
        await writeFileAtomic(path.join(home(), SECRETS_FILE), JSON.stringify(secrets, null, 2));
      },
      async delete(name) {
        const secrets = await readSecrets();
        if (!(name in secrets)) return;
        delete secrets[name];
        await writeFileAtomic(path.join(home(), SECRETS_FILE), JSON.stringify(secrets, null, 2));
      },
    },
    userFiles: {
      async open(name, bytes) {
        const error = await shell.openPath(await tempFile(name, bytes));
        if (error) throw new Error(error);
      },
      async save(name, bytes) {
        const result = await dialog.showSaveDialog({ defaultPath: name });
        if (result.canceled || !result.filePath) return false;
        await fs.writeFile(result.filePath, bytes);
        return true;
      },
      async pick() {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
        });
        if (result.canceled) return [];
        return Promise.all(
          result.filePaths.map(async (file) => ({
            name: path.basename(file),
            mimeType:
              MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream",
            bytes: new Uint8Array(await fs.readFile(file)),
          })),
        );
      },
    },

    google: googleAuth,
    relayUrl: process.env.OTTER_MAIL_RELAY_URL?.trim() || "https://relay.mail.otterware.dev",
    relaySession: "bearer",
    deviceName: computerName(),

    broadcast,
    notify(options) {
      if (!Notification.isSupported()) return;
      const notification = new Notification(options);
      notification.on("click", () => void focusMainWindow());
      notification.show();
    },
    setUnreadCount(count) {
      app.dock?.setBadge(count > 0 ? String(count) : "");
      void refreshTray();
    },
    onResume(listener) {
      powerMonitor.on("resume", listener);
      return () => powerMonitor.off("resume", listener);
    },
    asyncContext<T>(): AsyncContext<T> {
      const storage = new AsyncLocalStorage<T>();
      return { run: (value, fn) => storage.run(value, fn), get: () => storage.getStore() };
    },
    offlineDownloads: true,
    translator: appleTranslator,
  };
}
