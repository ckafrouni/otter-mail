/**
 * The provider registry + routing layer (T3 Code's ProviderService in
 * miniature). Health snapshots are managed like T3's: served from cache at
 * once, re-checked in the background when stale or when settings change, and
 * pushed to the windows as `assistant:providersChanged`. Chat turns are
 * fire-and-forget; their events stream as `assistant:chatEvent`.
 */

import { ipcMain, logger } from "@glaze/core/backend";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
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

const PROVIDERS: Record<ProviderKind, ChatProvider> = {
  hermes: hermesProvider,
  codex: codexProvider,
  claude: claudeProvider,
};

/** Re-check health when a snapshot is older than this (T3's default interval). */
const STALE_AFTER_MS = 5 * 60_000;

const snapshots = new Map<ProviderKind, ProviderSnapshot>();
const checking = new Map<ProviderKind, Promise<void>>();

function pendingSnapshot(kind: ProviderKind, settings: ProviderSettings): ProviderSnapshot {
  return {
    kind,
    displayName: PROVIDERS[kind].displayName,
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
  const providers = PROVIDER_KINDS.map((kind) => {
    const snapshot = snapshots.get(kind) ?? pendingSnapshot(kind, settings);
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
    providers,
    selected,
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
  ipcMain.broadcast("assistant:providersChanged", await getState());
}

/** Single-flight health check of one provider; broadcasts when it lands. */
function check(kind: ProviderKind): Promise<void> {
  const inFlight = checking.get(kind);
  if (inFlight) return inFlight;
  const run = (async () => {
    const settings = await getProviderSettings();
    if (!settings[kind].enabled) return;
    const result = await PROVIDERS[kind].checkStatus(settings);
    snapshots.set(kind, { ...result, enabled: true, checkedAt: Date.now() });
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
    if (p.enabled && (!p.checkedAt || Date.now() - p.checkedAt > STALE_AFTER_MS))
      void check(p.kind);
  }
  return state;
}

export async function refreshProviders(): Promise<void> {
  await Promise.all(PROVIDER_KINDS.map(check));
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
    if (!changed) continue;
    // A new binary / home: drop running processes and re-probe.
    if (LAUNCH_KEYS.some((key) => key in changed)) {
      PROVIDERS[kind].shutdown();
      snapshots.delete(kind);
      void check(kind);
    } else if ("enabled" in changed && next[kind].enabled) void check(kind);
  }
  const state = await getState();
  ipcMain.broadcast("assistant:providersChanged", state);
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
  snapshots.delete("hermes");
  void check("hermes");
  return getState();
}

function emit(event: ChatEvent): void {
  ipcMain.broadcast("assistant:chatEvent", event);
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
  void PROVIDERS[kind].sendTurn(turn, settings, emit).catch((error: unknown) => {
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
  await PROVIDERS[kind].respondApproval(requestId, approvalId, decision);
}

/** Adds a message to a running turn; false → the caller queues it instead. */
export async function steerTurn(
  kind: ProviderKind,
  requestId: string,
  input: string,
): Promise<boolean> {
  const accepted = await PROVIDERS[kind].steer(requestId, input);
  logger.info("assistant", "steer", { provider: kind, requestId, accepted });
  return accepted;
}

export function cancelTurn(kind: ProviderKind, requestId: string): void {
  PROVIDERS[kind].cancel(requestId);
}

export async function listSkills(kind: ProviderKind): Promise<Skill[]> {
  return PROVIDERS[kind].listSkills(await getProviderSettings());
}

export async function listSessions(kind: ProviderKind, limit: number): Promise<ChatSession[]> {
  return PROVIDERS[kind].listSessions(
    await getProviderSettings(),
    Math.min(Math.max(limit, 1), 200),
  );
}

export async function readSession(
  kind: ProviderKind,
  sessionId: string,
): Promise<ChatSessionMessage[]> {
  return PROVIDERS[kind].readSession(await getProviderSettings(), sessionId);
}

export async function deleteSession(kind: ProviderKind, sessionId: string): Promise<void> {
  await PROVIDERS[kind].deleteSession(await getProviderSettings(), sessionId);
}

export function shutdownProviders(): void {
  for (const provider of Object.values(PROVIDERS)) provider.shutdown();
}
