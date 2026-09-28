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

export interface DesktopBridge {
  platform: "darwin" | "linux" | "win32" | (string & {});
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
