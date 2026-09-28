/**
 * `window.desktopBridge` in a browser: the same API the desktop's preload
 * gives the renderer, backed by the mail backend (backend.ts: a Web Worker
 * shared by every open tab). The renderer can't tell the difference, except
 * through `features`, which switch off what only the Mac app has.
 *
 * A few things belong to the page itself: window-level channels (settings
 * navigation, ⌘W), and whatever needs the user's click to be allowed (file
 * pickers, Google's sign-in popup). Those start right when the renderer
 * invokes the channel, and the backend's request picks up what they return.
 */

import type {
  DesktopBridge,
  NativeThemeInfo,
  ThemeSource,
  UpdateState,
} from "@otter-mail/contracts";

import { connectBackend } from "./backend";
import { detectLanguage, hasBuiltInTranslator, translate } from "./translator";
import {
  SIGN_IN_CANCELLED,
  type GoogleSignInResult,
  type PageEffect,
  type PageRequests,
} from "./protocol";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "https://relay.mail.otterware.dev";
const THEME_SOURCE_KEY = "otter:theme-source";

type Listener = (params: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
function emit(channel: string, params?: unknown): void {
  for (const listener of listeners.get(channel) ?? []) listener(params);
}

// ── Things that need the user's click ──────────────────────────────────────

/** Actions started when the renderer invoked their channel, for the worker's request to collect. */
const started: { [K in keyof PageRequests]?: Promise<PageRequests[K]["result"]> } = {};

function pickFiles(): Promise<PageRequests["pickFiles"]["result"]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("cancel", () => resolve([]));
    input.addEventListener("change", async () => {
      const files = [...(input.files ?? [])];
      resolve(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
      );
    });
    input.click();
  });
}

let signInPopup: Window | null = null;

/** The relay's Gmail sign-in popup; resolves with what it posts back. */
function googleSignIn(loginHint?: string): Promise<GoogleSignInResult> {
  const url = new URL(`${RELAY_URL}/v1/gmail/authorize`);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  signInPopup?.close();
  const popup = window.open(url, "otter-gmail-sign-in", "popup,width=520,height=680");
  signInPopup = popup;
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(closedCheck);
      if (signInPopup === popup) signInPopup = null;
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; result?: GoogleSignInResult; error?: string };
      if (event.origin !== new URL(RELAY_URL).origin || data?.type !== "otter:gmail-sign-in") {
        return;
      }
      done();
      if (data.result) resolve(data.result);
      else reject(new Error(data.error ?? "Google sign-in failed."));
    };
    const closedCheck = setInterval(() => {
      if (!popup || popup.closed) {
        done();
        reject(new Error(SIGN_IN_CANCELLED));
      }
    }, 500);
    window.addEventListener("message", onMessage);
  });
}

// ── Effects ────────────────────────────────────────────────────────────────

function saveBytes(name: string, bytes: Uint8Array, open: boolean): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  if (open) {
    window.open(url, "_blank", "noopener");
  } else {
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function applyEffect(effect: PageEffect): void {
  switch (effect.kind) {
    case "notify":
      if ("Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(effect.title, {
          body: [effect.subtitle, effect.body].filter(Boolean).join(" · "),
        });
        notification.addEventListener("click", () => window.focus());
      }
      break;
    case "badge":
      document.title = effect.count > 0 ? `(${effect.count}) Otter Mail` : "Otter Mail";
      void navigator.setAppBadge?.(effect.count).catch(() => {});
      break;
    case "download":
    case "open":
      saveBytes(effect.name, effect.bytes, effect.kind === "open");
      break;
  }
}

// ── The backend ────────────────────────────────────────────────────────────

const backend = connectBackend({
  onEvent: emit,
  async onRequest(kind, params) {
    if (kind === "detectLanguage") {
      return detectLanguage((params as PageRequests["detectLanguage"]["params"]).text) as never;
    }
    if (kind === "translate") {
      const { texts, source, target } = params as PageRequests["translate"]["params"];
      return translate(texts, source, target) as never;
    }
    const action =
      started[kind] ??
      (kind === "pickFiles"
        ? pickFiles()
        : googleSignIn((params as { loginHint?: string } | undefined)?.loginHint));
    delete started[kind];
    return action as never;
  },
  onEffect: applyEffect,
  onFailed: (error) => console.error("The mail backend failed to start:", error),
});

// ── Channels the page answers itself ───────────────────────────────────────

let settingsTarget: unknown = null;

const pageChannels: Record<string, (params: unknown) => unknown> = {
  "window:openSettings": (params) => {
    settingsTarget = params;
    emit("settings:open");
  },
  "window:getSettingsTarget": () => {
    const target = settingsTarget;
    settingsTarget = null;
    return target;
  },
  "window:takePendingOpenMessage": () => null,
  "window:closeMain": () => {},
  "app:takePendingMailto": () => null,
  "edit:nativeUndo": () => document.execCommand("undo"),
};

async function invoke<T>(channel: string, params?: unknown): Promise<T> {
  const local = pageChannels[channel];
  if (local) return (await local(params)) as T;

  // Start what needs the click now, while it counts as the user's.
  if (channel === "gmail:pickAttachments") started.pickFiles = pickFiles();
  if (channel === "gmail:addAccount") {
    started.googleSignIn = googleSignIn((params as { email?: string } | undefined)?.email);
  }
  if (channel === "gmail:cancelAddAccount") signInPopup?.close();

  if (channel === "otter:signIn") {
    const result = await backend.invoke<{ redirectTo?: string } | null>(channel, {
      ...(params as object),
      callbackURL: `${location.origin}/`,
    });
    if (result?.redirectTo) location.assign(result.redirectTo);
    return result as T;
  }
  const result = await backend.invoke<T>(channel, params);
  // Signed out (or the account deleted): back to the landing page.
  if (channel === "otter:signOut" || channel === "otter:deleteAccount") location.assign("/");
  return result;
}

// ── Theme (a browser can't change prefers-color-scheme; store the choice) ──

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function themeSource(): ThemeSource {
  const stored = localStorage.getItem(THEME_SOURCE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function themeInfo(): NativeThemeInfo {
  const source = themeSource();
  return {
    shouldUseDarkColors: source === "system" ? darkQuery.matches : source === "dark",
    themeSource: source,
    shouldUseHighContrastColors: window.matchMedia("(prefers-contrast: more)").matches,
    prefersReducedTransparency: window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
  };
}

const updatesDisabled: UpdateState = {
  status: "disabled",
  currentVersion: __APP_VERSION__,
  availableVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: "The web app is always up to date.",
  manualDownloadUrl: null,
};

export const webBridge: DesktopBridge = {
  platform: "web",
  features: {
    trafficLights: false,
    menuBar: false,
    launchAtLogin: false,
    defaultMailApp: false,
    translation: hasBuiltInTranslator,
    keybindingsFile: false,
    dragOut: false,
  },
  invoke,
  on(channel, listener) {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  },
  openExternal: async (url) => void window.open(url, "_blank", "noopener"),
  nativeTheme: {
    getInfo: async () => themeInfo(),
    async setThemeSource(source) {
      if (source === "system") localStorage.removeItem(THEME_SOURCE_KEY);
      else localStorage.setItem(THEME_SOURCE_KEY, source);
      window.dispatchEvent(new Event("otter:theme-change"));
    },
  },
  updates: {
    getState: async () => updatesDisabled,
    check: async () => updatesDisabled,
    download: async () => updatesDisabled,
    install: async () => {},
    onState: () => () => {},
  },
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") backend.resume();
});

// Notifications need permission, which browsers only ask for after a click.
if ("Notification" in window && Notification.permission === "default") {
  window.addEventListener("pointerdown", () => void Notification.requestPermission(), {
    once: true,
  });
}

/** The web app needs an Otter account (it holds the Gmail sign-ins): sign in first. */
export async function requireOtterAccount(): Promise<void> {
  const state = await invoke<{ user: unknown }>("otter:getState");
  if (!state.user) await invoke("otter:signIn");
  webBridge.on("otter:state", (next) => {
    if (!(next as { user: unknown }).user) location.assign("/");
  });
}
