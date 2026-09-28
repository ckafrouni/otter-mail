/**
 * Preferences that follow the Otter account to every device (the relay's
 * `/v1/preferences`): app settings, views, keybindings, the assistant's
 * settings and Hermes key, and the renderer's UI choices (`ui`, which it
 * mirrors from localStorage). Each section is replaced whole; the last write
 * wins.
 *
 * On connecting (and on the relay's `preferences` event) this device takes
 * the account's sections. A section the account doesn't have yet (a new
 * account, or one from before the section existed) is seeded from here.
 * Local changes are pushed when they differ from what was last synced, which
 * also keeps an applied remote section from echoing back.
 */

import type { PreferencesResponse } from "@otter-mail/contracts/relay";

import { broadcast } from "../ipc.js";
import { readJson, writeJson } from "../json-file.js";
import { logger } from "../logger.js";
import {
  applySyncedHermesKey,
  applySyncedProviderSettings,
  syncedProviderSettings,
  type SyncedProviderSettings,
} from "./assistant/service.js";
import { getHermesKey } from "./assistant/settings.js";
import { readKeybindings, writeKeybindings } from "./keybindings-store.js";
import { configureAutoSync } from "./mail-sync.js";
import { getOtterUser, relayRequest } from "./otter-account.js";
import { getSettings, updateSettings, type AppSettings } from "./settings-store.js";
import { listViews, writeViews } from "./views-store.js";
import type { MailView } from "../types.js";

// ── UI preferences (the renderer's, kept here so every device can have them) ─

const UI_FILE = "ui-preferences.json";
export type UiPreferences = Record<string, string>;

export async function getUiPreferences(): Promise<UiPreferences> {
  return (await readJson<UiPreferences>(UI_FILE)) ?? {};
}

async function writeUiPreferences(ui: UiPreferences): Promise<void> {
  await writeJson(UI_FILE, ui);
  broadcast("preferences:uiChanged", ui);
}

export async function setUiPreference(key: string, value: string): Promise<void> {
  const ui = await getUiPreferences();
  if (ui[key] === value) return;
  await writeUiPreferences({ ...ui, [key]: value });
  preferenceChanged("ui");
}

// ── Sections ────────────────────────────────────────────────────────────────

/** App settings that follow the account (launch at login and the menu bar stay per Mac). */
const SYNCED_SETTINGS = [
  "syncIntervalSeconds",
  "notificationsMode",
  "readLanguages",
  "autoTranslate",
] as const satisfies readonly (keyof AppSettings)[];

type Section = {
  /** This device's value; undefined when it has none worth sharing. */
  read(): Promise<unknown>;
  apply(value: unknown): Promise<void>;
};

const SECTIONS = {
  settings: {
    async read() {
      const settings = await getSettings();
      return Object.fromEntries(SYNCED_SETTINGS.map((key) => [key, settings[key]]));
    },
    async apply(value) {
      const patch = Object.fromEntries(
        Object.entries(value as Partial<AppSettings>).filter(([key]) =>
          (SYNCED_SETTINGS as readonly string[]).includes(key),
        ),
      );
      const settings = await updateSettings(patch);
      configureAutoSync(settings.syncIntervalSeconds);
      broadcast("settings:changed", settings);
      broadcast("translation:settingsChanged");
    },
  },
  views: {
    read: () => listViews(),
    async apply(value) {
      if (!Array.isArray(value)) return;
      await writeViews(value as MailView[]);
      broadcast("gmail:views-changed");
    },
  },
  keybindings: {
    // No keybindings.json yet: the defaults, nothing to share.
    read: async () => (await readKeybindings()).rules ?? undefined,
    async apply(value) {
      await writeKeybindings(value);
      broadcast("keybindings:updated");
    },
  },
  assistant: {
    read: () => syncedProviderSettings(),
    apply: (value) => applySyncedProviderSettings(value as Partial<SyncedProviderSettings>),
  },
  ui: {
    read: () => getUiPreferences(),
    async apply(value) {
      if (value && typeof value === "object") await writeUiPreferences(value as UiPreferences);
    },
  },
} satisfies Record<string, Section>;

export type SectionName = keyof typeof SECTIONS;
const SECTION_NAMES = Object.keys(SECTIONS) as SectionName[];

/** What each section (and the Hermes key) was when last synced, as JSON. */
const synced = new Map<SectionName | "hermesKey", string>();

// ── Sync ────────────────────────────────────────────────────────────────────

/** Takes the account's preferences, and seeds the ones it doesn't have from here. */
export async function pullPreferences(): Promise<void> {
  if (!getOtterUser()) return;
  const remote = await relayRequest<PreferencesResponse>("GET", "/v1/preferences");
  for (const name of SECTION_NAMES) {
    const value = remote.preferences[name];
    if (value === undefined) {
      preferenceChanged(name);
      continue;
    }
    const json = JSON.stringify(value);
    synced.set(name, json);
    if (JSON.stringify(await SECTIONS[name].read()) === json) continue;
    try {
      await SECTIONS[name].apply(value);
    } catch (err) {
      logger.warn("preferences", `Couldn't apply ${name}: ${String(err)}`);
    }
  }
  if (remote.hermesKey) {
    synced.set("hermesKey", JSON.stringify(remote.hermesKey));
    await applySyncedHermesKey(remote.hermesKey);
  } else {
    preferenceChanged("hermesKey");
  }
}

const pending = new Set<SectionName | "hermesKey">();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** A section changed on this device: push it (debounced) if it differs from the account's. */
export function preferenceChanged(name: SectionName | "hermesKey"): void {
  if (!getOtterUser()) return;
  pending.add(name);
  pushTimer ??= setTimeout(() => void push(), 500);
}

async function push(): Promise<void> {
  pushTimer = null;
  const names = [...pending];
  pending.clear();
  const preferences: Record<string, unknown> = {};
  let hermesKey: string | undefined;
  for (const name of names) {
    const value = name === "hermesKey" ? await getHermesKey() : await SECTIONS[name].read();
    if (value === undefined || value === "") continue;
    const json = JSON.stringify(value);
    if (synced.get(name) === json) continue;
    synced.set(name, json);
    if (name === "hermesKey") hermesKey = value as string;
    else preferences[name] = value;
  }
  if (Object.keys(preferences).length === 0 && hermesKey === undefined) return;
  try {
    await relayRequest("PUT", "/v1/preferences", { preferences, hermesKey });
  } catch (err) {
    // Try again with the next change or connection.
    for (const name of names) synced.delete(name);
    logger.info("preferences", `Couldn't save preferences: ${String(err)}`);
  }
}

/** Signed out: the next account starts from what it has. */
export function forgetSyncedPreferences(): void {
  synced.clear();
  pending.clear();
}
