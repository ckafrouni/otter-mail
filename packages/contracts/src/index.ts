/**
 * The surface the preload script exposes to renderer windows as
 * `window.desktopBridge`. Everything the UI asks of the main process goes
 * through `invoke` (request/response, handled with `ipcMain.handle`) or `on`
 * (main → renderer pushes, sent with `broadcast`).
 */

export type ThemeSource = "system" | "light" | "dark";

export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: ThemeSource;
  shouldUseHighContrastColors: boolean;
  prefersReducedTransparency: boolean;
}

export type UpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  checkedAt: number | null;
  message: string | null;
  /**
   * Set when macOS refused to install a downloaded update (a build without a
   * Developer ID signature): the release page to install it from by hand.
   */
  manualDownloadUrl: string | null;
}

/**
 * What the shell running the app can do. The desktop app has everything; the
 * web app (a browser tab) has none of these, and the UI hides them.
 */
export interface BridgeFeatures {
  /** macOS window chrome: traffic lights over the window's top-left corner. */
  trafficLights: boolean;
  /** The menu-bar icon and mini inbox. */
  menuBar: boolean;
  launchAtLogin: boolean;
  /** Being the Mac's default mail app (mailto: links). */
  defaultMailApp: boolean;
  /** Apple's on-device translation. */
  translation: boolean;
  /** Local assistant CLIs (Claude Code, Codex, Hermes). */
  assistant: boolean;
  /** keybindings.json on disk, opened in an editor. */
  keybindingsFile: boolean;
  /** Dragging attachments out to Finder. */
  dragOut: boolean;
}

export interface DesktopBridge {
  /** `process.platform` in the desktop app, "web" in a browser. */
  platform: "darwin" | "linux" | "win32" | "web" | (string & {});
  features: BridgeFeatures;
  /** Call a main-process handler registered with `ipcMain.handle(channel, …)`. */
  invoke<T = unknown>(channel: string, params?: unknown): Promise<T>;
  /** Listen for a main-process push on `channel`. Returns an unsubscribe function. */
  on(channel: string, listener: (params: unknown) => void): () => void;
  openExternal(url: string): Promise<void>;
  /** Absolute path of a File dropped or picked in the renderer ("" when it has none). */
  getPathForFile(file: File): string;
  nativeTheme: {
    getInfo(): Promise<NativeThemeInfo>;
    setThemeSource(source: ThemeSource): Promise<void>;
  };
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
    onState(listener: (state: UpdateState) => void): () => void;
  };
}

/** Push channel carrying `UpdateState` changes. */
export const UPDATE_STATE_CHANNEL = "updates:state";

/**
 * The Otter account as the renderer sees it (`otter:getState`, and pushed on
 * `otter:state`): who is signed in, and whether new mail arrives by push.
 */
export interface OtterAccountState {
  user: { email: string; name: string | null; picture: string | null } | null;
  /** "live": the relay's event stream is connected, so Gmail changes arrive within seconds. */
  realtime: "off" | "connecting" | "live";
}

/** A Mac signed in to the Otter account (`otter:listDevices`). */
export interface OtterDevice {
  /** Its session token, which `otter:signOutDevice` takes. */
  token: string;
  name: string;
  /** This Mac. */
  current: boolean;
  lastActiveAt: number;
}

/** Push channel carrying `OtterAccountState` changes. */
export const OTTER_ACCOUNT_STATE_CHANNEL = "otter:state";

/**
 * What Otter Mail asks Google for when a Gmail account signs in (the desktop
 * app, and the relay for the web app).
 */
export const GMAIL_SCOPES = [
  "https://mail.google.com/",
  "openid",
  "email",
  "profile",
  // People API, for sender avatars. Tokens issued before these scopes were
  // added simply 403 on People calls (the avatar cascade skips to Gravatar);
  // re-adding the account upgrades its consent in place.
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  // Calendar, for answering invitations in place. Older tokens lack it: RSVP
  // then falls back to an email reply; re-adding the account upgrades it.
  "https://www.googleapis.com/auth/calendar.events",
];
