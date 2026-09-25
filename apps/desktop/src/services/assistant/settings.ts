/**
 * Provider settings (userData/assistant-providers.json) plus the Hermes API
 * key, which is full agent control: safeStorage-encrypted in
 * userData/assistant-chat.enc, never sent to the renderer, never logged.
 */

import fs from "fs/promises";
import path from "path";
import { app, safeStorage } from "electron";
import {
  PROVIDER_KINDS,
  RUNTIME_MODES,
  type ClaudeSettings,
  type RuntimeMode,
  type CodexSettings,
  type HermesSettings,
  type ProviderKind,
  type ProviderSettings,
} from "./types.js";

const DEFAULT_HERMES: HermesSettings = {
  enabled: true,
  baseUrl: "",
  agentModel: "hermes-agent",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
};

/** Before model choice existed, `model` held the agent id (now `agentModel`). */
function migrateHermes(stored: Partial<HermesSettings>): Partial<HermesSettings> {
  if (stored.model && !stored.model.includes("::") && !stored.agentModel)
    return { ...stored, agentModel: stored.model, model: "" };
  return stored;
}

const DEFAULT_CODEX: CodexSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  launchArgs: "",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "full-access",
};

const DEFAULT_CLAUDE: ClaudeSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "full-access",
};

/** Runtime modes from before T3's set ("read-only") fall back to supervised. */
function migrateRuntimeMode<T extends { runtimeMode: RuntimeMode }>(settings: T): T {
  return RUNTIME_MODES.includes(settings.runtimeMode)
    ? settings
    : { ...settings, runtimeMode: "approval-required" };
}

async function userDataFile(name: string): Promise<string> {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

async function readJson<T>(name: string): Promise<Partial<T> | null> {
  try {
    return JSON.parse(await fs.readFile(await userDataFile(name), "utf-8")) as Partial<T>;
  } catch {
    return null;
  }
}

let cache: ProviderSettings | null = null;

export async function getProviderSettings(): Promise<ProviderSettings> {
  if (cache) return cache;
  const stored = await readJson<ProviderSettings>("assistant-providers.json");
  // Before providers existed, Hermes' connection lived in assistant-chat.json.
  const legacyHermes = stored ? null : await readJson<HermesSettings>("assistant-chat.json");
  const selected = PROVIDER_KINDS.includes(stored?.selected as ProviderKind)
    ? (stored?.selected as ProviderKind)
    : "hermes";
  cache = {
    selected,
    hermes: {
      ...DEFAULT_HERMES,
      ...migrateHermes({ ...legacyHermes, ...stored?.hermes }),
    },
    codex: migrateRuntimeMode({ ...DEFAULT_CODEX, ...stored?.codex }),
    claude: migrateRuntimeMode({ ...DEFAULT_CLAUDE, ...stored?.claude }),
  };
  return cache;
}

export async function saveProviderSettings(next: ProviderSettings): Promise<void> {
  cache = next;
  await fs.writeFile(
    await userDataFile("assistant-providers.json"),
    JSON.stringify(next, null, 2),
    "utf-8",
  );
}

export async function getHermesKey(): Promise<string> {
  try {
    const hex = await fs.readFile(await userDataFile("assistant-chat.enc"), "utf-8");
    return await safeStorage.decryptString(Buffer.from(hex.trim(), "hex"));
  } catch {
    return "";
  }
}

export async function setHermesKey(key: string): Promise<void> {
  const encrypted = await safeStorage.encryptString(key);
  await fs.writeFile(await userDataFile("assistant-chat.enc"), encrypted.toString("hex"), "utf-8");
}

/** Codex threads started from Otter Mail run here (their cwd), so they're listable as ours. */
export async function assistantWorkspace(): Promise<string> {
  const dir = path.join(app.getPath("userData"), "assistant-workspace");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
