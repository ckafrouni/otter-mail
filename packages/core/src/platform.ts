/**
 * The seam between the mail backend (this package) and the shell running it:
 * Electron's main process on the desktop (apps/desktop/src/platform.ts), a
 * Web Worker in the browser (apps/web/src/web/platform.ts). Everything in
 * core that isn't plain TypeScript goes through here; a shell calls
 * `initCore(platform)` once before using anything else.
 */

import type { GmailAccount } from "./types.js";

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
  run(...params: SqlValue[]): { changes: number | bigint };
}

/** The subset of `node:sqlite`'s DatabaseSync that the mail cache uses. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export type FileInfo = { name: string; size: number; modifiedAt: number };

export type PickedFile = { name: string; mimeType: string; bytes: Uint8Array };

/** Gmail sign-in and tokens, per account (keyed by the account's address). */
export interface GoogleAuth {
  /** Reads stored sign-ins; call once at startup so `isSignedIn` answers right away. */
  load(): Promise<void>;
  /** Signs an account in (or back in: `loginHint`); stores it and returns it. */
  addAccount(loginHint?: string): Promise<GmailAccount>;
  /** Stops waiting for a sign-in in progress; `addAccount` rejects with SignInCancelledError. */
  cancelSignIn(): void;
  isSignedIn(accountId: string): boolean;
  getAccessToken(accountId: string, opts?: { forceRefresh?: boolean }): Promise<string>;
  /** A fresh Google ID token for the account, proving the sign-in to the relay. */
  getIdToken(accountId: string): Promise<string>;
  /**
   * The desktop's Otter sign-in with another Google account: Google in the
   * browser, identity only. (The web app signs in by redirect instead.)
   */
  signInForIdToken?(): Promise<string>;
  removeTokens(accountId: string): Promise<void>;
}

export type LanguageDetection = { language: string | null; confidence: number };

/**
 * `needsDownload`: the browser must download the language pack, which it
 * only does after a click. `notInstalled`: the Mac's languages must be
 * downloaded in System Settings.
 */
export type TranslationStatus =
  | "ok"
  | "notInstalled"
  | "needsDownload"
  | "unsupported"
  | "unavailable";

export type TranslationResult = { status: TranslationStatus; texts: string[] };

/** On-device translation: Apple Translation on the Mac, Chrome's built-in Translator on the web. */
export interface Translator {
  detect(text: string): Promise<LanguageDetection>;
  translate(texts: string[], source: string, target: string): Promise<TranslationResult>;
}

/** Tells background work (sync, prefetch) apart from the user's own requests. */
export interface AsyncContext<T> {
  run<R>(value: T, fn: () => R): R;
  get(): T | undefined;
}

export interface Platform {
  kind: "desktop" | "web";
  appVersion: string;
  log(
    level: "debug" | "info" | "warn" | "error",
    scope: string,
    message: string,
    data?: unknown,
  ): void;

  /** The mail cache: node:sqlite on the desktop, SQLite WASM (OPFS) on the web. */
  database(): SqlDatabase;
  /** The app's own files (settings, accounts, caches), by relative path. */
  files: {
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, data: Uint8Array | string): Promise<void>;
    remove(path: string): Promise<void>;
    list(dir: string): Promise<FileInfo[]>;
  };
  /** Small secrets (session tokens), encrypted at rest where the platform can. */
  secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  /** Files the user opens, saves or picks. */
  userFiles: {
    open(name: string, bytes: Uint8Array): Promise<void>;
    /** False when the user cancelled. */
    save(name: string, bytes: Uint8Array): Promise<boolean>;
    pick(): Promise<PickedFile[]>;
  };

  google: GoogleAuth;
  /** The relay (infra/relay): Otter accounts, linked accounts, push. */
  relayUrl: string;
  /**
   * How the relay knows this device: a bearer token the desktop keeps, or
   * the browser's session cookie (signed in by redirect).
   */
  relaySession: "bearer" | "cookie";
  /** How this device appears in the Otter account's device list. */
  deviceName?: string;

  /** Push to every window (renderer: `desktopBridge.on`). */
  broadcast(channel: string, params?: unknown): void;
  notify(notification: { title: string; subtitle?: string; body?: string }): void;
  /** Total unread in the inbox, for the Dock or tab badge. */
  setUnreadCount(count: number): void;
  /** Runs `listener` after the machine wakes or the network comes back. */
  onResume(listener: () => void): () => void;
  asyncContext<T>(): AsyncContext<T>;
  /** Download bodies of all mail for offline reading (not in a browser's storage). */
  offlineDownloads: boolean;
  /** Absent where there's no on-device translator (browsers other than Chrome). */
  translator?: Translator;
}

let current: Platform | null = null;

export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error("initCore() has not run.");
  return current;
}
