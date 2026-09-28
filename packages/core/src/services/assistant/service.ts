/**
 * The provider registry + routing layer (T3 Code's ProviderService in
 * miniature). Health snapshots are managed like T3's: served from cache at
 * once, re-checked in the background when stale or when settings change, and
 * pushed to the windows as `assistant:providersChanged`. Chat turns are
 * fire-and-forget; their events stream as `assistant:chatEvent`.
 *
 * Hermes is a server, so it works everywhere; Codex and Claude are local
 * CLIs, which the Mac app hands over as `Platform.assistantProviders`. The
 * web app lists them, off (`macAppOnly`).
 */

import { broadcast } from "../../ipc.js";
import { logger } from "../../logger.js";
import { platform } from "../../platform.js";
import {
  fetchHermesModels,
  hermesProvider,
  normalizeHermesBaseUrl,
  probeHermesSessions,
} from "./hermes.js";
import {
  getHermesKey,
  getProviderSettings,
  saveProviderSettings,
  setHermesKey,
} from "./settings.js";
import {
  PROVIDER_KINDS,
  type ApprovalDecision,
  type ChatEvent,
  type ChatProvider,
  type ChatSession,
  type ChatSessionMessage,
  type ProviderKind,
  type ProviderSettings,
  type ProviderSnapshot,
  type ProvidersState,
  type SendTurnInput,
  type Skill,
} from "./types.js";

let providers: Partial<Record<ProviderKind, ChatProvider>> | null = null;

/** The providers this platform runs. */
function available(): Partial<Record<ProviderKind, ChatProvider>> {
  providers ??= Object.fromEntries(
    [hermesProvider, ...(platform().assistantProviders ?? [])].map((p) => [p.kind, p]),
  );
  return providers;
}

function provider(kind: ProviderKind): ChatProvider {
  const found = available()[kind];
  if (!found) throw new Error("This assistant runs in the Mac app.");
  return found;
}

const DISPLAY_NAMES: Record<ProviderKind, string> = {
  hermes: "Hermes",
  codex: "Codex",
  claude: "Claude",
};

/** Re-check health when a snapshot is older than this (T3's default interval). */
const STALE_AFTER_MS = 5 * 60_000;

const checked = new Map<ProviderKind, ProviderSnapshot>();
const checking = new Map<ProviderKind, Promise<void>>();

function pendingSnapshot(kind: ProviderKind, settings: ProviderSettings): ProviderSnapshot {
  return {
    kind,
    displayName: available()[kind]?.displayName ?? DISPLAY_NAMES[kind],
    enabled: settings[kind].enabled,
    installed: false,
    version: null,
    status: settings[kind].enabled ? "warning" : "disabled",
    auth: { status: "unknown" },
    checkedAt: null,
    models: [],
    model: null,
    sessions: false,
  };
}

async function getState(): Promise<ProvidersState> {
  const settings = await getProviderSettings();
  const snapshots = PROVIDER_KINDS.map((kind) => {
    if (!available()[kind]) {
      return {
        ...pendingSnapshot(kind, settings),
        enabled: false,
        status: "disabled",
        checkedAt: 0,
        message: "Available in the Mac app.",
        macAppOnly: true,
      } satisfies ProviderSnapshot;
    }
    const snapshot = checked.get(kind) ?? pendingSnapshot(kind, settings);
    const enabled = settings[kind].enabled;
    const chosen = settings[kind].model;
    const fallback = snapshot.models.find((m) => m.isDefault)?.slug ?? snapshot.models[0]?.slug;
    return {
      ...snapshot,
      enabled,
      status: enabled ? snapshot.status : "disabled",
      model: chosen || fallback || null,
    } as ProviderSnapshot;
  });
  const { hermes, codex, claude, selected } = settings;
  return {
    providers: snapshots,
    selected: available()[selected] ? selected : "hermes",
    settings: {
      hermes,
      codex,
      claude,
      selected,
      hermesHasKey: (await getHermesKey()).length > 0,
    },
  };
}

async function broadcastState(): Promise<void> {
  broadcast("assistant:providersChanged", await getState());
}

/** Single-flight health check of one provider; broadcasts when it lands. */
function check(kind: ProviderKind): Promise<void> {
  const inFlight = checking.get(kind);
  if (inFlight) return inFlight;
  const run = (async () => {
    const settings = await getProviderSettings();
    const found = available()[kind];
    if (!found || !settings[kind].enabled) return;
    const result = await found.checkStatus(settings);
    checked.set(kind, { ...result, enabled: true, checkedAt: Date.now() });
    logger.info("assistant", "provider checked", {
      kind,
      status: result.status,
      version: result.version,
    });
  })()
    .catch((error: unknown) =>
      logger.info("assistant", "provider check failed", {
        kind,
        error: String(error),
      }),
    )
    .finally(() => {
      checking.delete(kind);
      void broadcastState();
    });
  checking.set(kind, run);
  return run;
}

/** Cached state now; stale or never-checked providers refresh in the background. */
export async function providersState(): Promise<ProvidersState> {
  const state = await getState();
  for (const p of state.providers) {
    if (p.enabled && !p.macAppOnly && (!p.checkedAt || Date.now() - p.checkedAt > STALE_AFTER_MS))
      void check(p.kind);
  }
  return state;
}

export async function refreshProviders(): Promise<void> {
  await Promise.all(PROVIDER_KINDS.filter((kind) => available()[kind]).map(check));
}

export type SettingsPatch = {
  selected?: ProviderKind;
  hermes?: Partial<
    Pick<ProviderSettings["hermes"], "enabled" | "model" | "reasoningEffort" | "serviceTier">
  >;
  codex?: Partial<ProviderSettings["codex"]>;
  claude?: Partial<ProviderSettings["claude"]>;
};

/** Settings that change how a provider's process is launched. */
const LAUNCH_KEYS = ["binaryPath", "homePath", "launchArgs"];

export async function updateProviderSettings(patch: SettingsPatch): Promise<ProvidersState> {
  const current = await getProviderSettings();
  const next: ProviderSettings = {
    selected:
      patch.selected && PROVIDER_KINDS.includes(patch.selected) ? patch.selected : current.selected,
    hermes: { ...current.hermes, ...patch.hermes },
    codex: { ...current.codex, ...patch.codex },
    claude: { ...current.claude, ...patch.claude },
  };
  await saveProviderSettings(next);
  for (const kind of PROVIDER_KINDS) {
    const changed = patch[kind];
    if (!changed || !available()[kind]) continue;
    // A new binary / home: drop running processes and re-probe.
    if (LAUNCH_KEYS.some((key) => key in changed)) {
      provider(kind).shutdown();
      checked.delete(kind);
      void check(kind);
    } else if ("enabled" in changed && next[kind].enabled) void check(kind);
  }
  const state = await getState();
  broadcast("assistant:providersChanged", state);
  return state;
}

/** Verifies the URL and key against the server, then saves them. */
export async function connectHermes(baseUrl: string, apiKey: string): Promise<ProvidersState> {
  const base = normalizeHermesBaseUrl(baseUrl);
  const [models, sessions] = await Promise.all([
    fetchHermesModels(base, apiKey),
    probeHermesSessions(base, apiKey),
  ]);
  await setHermesKey(apiKey);
  const current = await getProviderSettings();
  await saveProviderSettings({
    ...current,
    hermes: {
      ...current.hermes,
      baseUrl: base,
      agentModel: models[0] || "hermes-agent",
      sessions,
    },
  });
  logger.info("assistant", "hermes connected", { baseUrl: base, sessions });
  checked.delete("hermes");
  void check("hermes");
  return getState();
}

function emit(event: ChatEvent): void {
  broadcast("assistant:chatEvent", event);
}

/** Starts a turn and returns at once; progress streams as chat events. */
export async function sendTurn(kind: ProviderKind, turn: SendTurnInput): Promise<void> {
  const settings = await getProviderSettings();
  logger.info("assistant", "send", {
    provider: kind,
    requestId: turn.requestId,
    chars: turn.input.length,
    session: turn.sessionId ? "existing" : "new",
    skill: turn.skill?.name,
  });
  if (!settings[kind].enabled) {
    emit({
      requestId: turn.requestId,
      type: "error",
      message: "provider_disabled",
    });
    return;
  }
  void provider(kind)
    .sendTurn(turn, settings, emit)
    .catch((error: unknown) => {
      logger.info("assistant", "turn crashed", {
        provider: kind,
        error: String(error),
      });
      emit({
        requestId: turn.requestId,
        type: "error",
        message: "unreachable",
      });
    });
}

export async function respondApproval(
  kind: ProviderKind,
  requestId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  logger.info("assistant", "approval", { provider: kind, requestId, decision });
  await provider(kind).respondApproval(requestId, approvalId, decision);
}

/** Adds a message to a running turn; false → the caller queues it instead. */
export async function steerTurn(
  kind: ProviderKind,
  requestId: string,
  input: string,
): Promise<boolean> {
  const accepted = await provider(kind).steer(requestId, input);
  logger.info("assistant", "steer", { provider: kind, requestId, accepted });
  return accepted;
}

export function cancelTurn(kind: ProviderKind, requestId: string): void {
  provider(kind).cancel(requestId);
}

export async function listSkills(kind: ProviderKind): Promise<Skill[]> {
  return provider(kind).listSkills(await getProviderSettings());
}

export async function listSessions(kind: ProviderKind, limit: number): Promise<ChatSession[]> {
  return provider(kind).listSessions(
    await getProviderSettings(),
    Math.min(Math.max(limit, 1), 200),
  );
}

export async function readSession(
  kind: ProviderKind,
  sessionId: string,
): Promise<ChatSessionMessage[]> {
  return provider(kind).readSession(await getProviderSettings(), sessionId);
}

export async function deleteSession(kind: ProviderKind, sessionId: string): Promise<void> {
  await provider(kind).deleteSession(await getProviderSettings(), sessionId);
}

export function shutdownProviders(): void {
  for (const found of Object.values(available())) found.shutdown();
}

// ── Preferences sync (services/preferences.ts) ──────────────────────────────

/** Where the CLIs live is this device's business; everything else follows the account. */
const DEVICE_KEYS = ["binaryPath", "homePath", "launchArgs"] as const;

type Synced<T> = Omit<T, (typeof DEVICE_KEYS)[number]>;
export type SyncedProviderSettings = {
  selected: ProviderKind;
  hermes: ProviderSettings["hermes"];
  codex: Synced<ProviderSettings["codex"]>;
  claude: Synced<ProviderSettings["claude"]>;
};

const withoutDeviceKeys = <T extends object>(settings: T) =>
  Object.fromEntries(
    Object.entries(settings).filter(([key]) => !(DEVICE_KEYS as readonly string[]).includes(key)),
  ) as Synced<T>;

export async function syncedProviderSettings(): Promise<SyncedProviderSettings> {
  const { selected, hermes, codex, claude } = await getProviderSettings();
  return { selected, hermes, codex: withoutDeviceKeys(codex), claude: withoutDeviceKeys(claude) };
}

/** Takes the account's provider settings, keeping this device's CLI paths. */
export async function applySyncedProviderSettings(
  synced: Partial<SyncedProviderSettings>,
): Promise<void> {
  const current = await getProviderSettings();
  const next: ProviderSettings = {
    selected:
      synced.selected && PROVIDER_KINDS.includes(synced.selected)
        ? synced.selected
        : current.selected,
    hermes: { ...current.hermes, ...synced.hermes },
    codex: { ...current.codex, ...(synced.codex && withoutDeviceKeys(synced.codex)) },
    claude: { ...current.claude, ...(synced.claude && withoutDeviceKeys(synced.claude)) },
  };
  await saveProviderSettings(next);
  if (next.hermes.baseUrl !== current.hermes.baseUrl) {
    provider("hermes").shutdown();
    checked.delete("hermes");
  }
  void check("hermes");
  await broadcastState();
}

/** Takes the account's Hermes key. */
export async function applySyncedHermesKey(key: string): Promise<void> {
  if (key === (await getHermesKey())) return;
  await setHermesKey(key);
  checked.delete("hermes");
  void check("hermes");
}
