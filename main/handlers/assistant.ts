/**
 * Assistant IPC: provider state/settings plus chat routing. Every call answers
 * well inside the 5s IPC budget — health checks and turns run in the
 * background and report via `assistant:providersChanged` / `assistant:chatEvent`.
 */

import { ipcMain } from "@glaze/core/backend";
import * as assistant from "../services/assistant/service.js";
import {
  PROVIDER_KINDS,
  RUNTIME_MODES,
  type ApprovalDecision,
  type ProviderKind,
  type RuntimeMode,
} from "../services/assistant/types.js";

type Params = Record<string, unknown> | undefined;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

function providerOf(p: Params): ProviderKind {
  const kind = p?.provider;
  if (typeof kind === "string" && PROVIDER_KINDS.includes(kind as ProviderKind))
    return kind as ProviderKind;
  throw new Error("Unknown assistant provider.");
}

function sessionIdOf(p: Params): string {
  const sessionId = str(p?.sessionId);
  if (!sessionId) throw new Error("A session id is required.");
  return sessionId;
}

/** Codex / Claude settings: enabled, model choices, launch paths, runtime mode. */
function agentPatch<K extends string>(
  raw: Record<string, unknown>,
  launchKeys: readonly K[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (bool(raw.enabled) !== undefined) out.enabled = bool(raw.enabled);
  for (const key of [...launchKeys, "model", "reasoningEffort", "serviceTier"]) {
    if (typeof raw[key] === "string") out[key] = str(raw[key]);
  }
  if (RUNTIME_MODES.includes(raw.runtimeMode as RuntimeMode)) out.runtimeMode = raw.runtimeMode;
  return out;
}

/** Only known fields of the right type make it into the patch. */
function settingsPatch(p: Params): assistant.SettingsPatch {
  const patch: assistant.SettingsPatch = {};
  if (typeof p?.selected === "string" && PROVIDER_KINDS.includes(p.selected as ProviderKind))
    patch.selected = p.selected as ProviderKind;
  const hermes = p?.hermes as Params;
  if (hermes) {
    const h: NonNullable<assistant.SettingsPatch["hermes"]> = {};
    if (bool(hermes.enabled) !== undefined) h.enabled = bool(hermes.enabled);
    for (const key of ["model", "reasoningEffort", "serviceTier"] as const) {
      if (typeof hermes[key] === "string") h[key] = str(hermes[key]);
    }
    patch.hermes = h;
  }
  const codex = p?.codex as Params;
  if (codex) patch.codex = agentPatch(codex, ["binaryPath", "homePath", "launchArgs"]);
  const claude = p?.claude as Params;
  if (claude) patch.claude = agentPatch(claude, ["binaryPath", "homePath"]);
  return patch;
}

export function registerAssistantHandlers(): void {
  ipcMain.handle("assistant:providers", async () => assistant.providersState());

  ipcMain.handle("assistant:refreshProviders", async () => {
    void assistant.refreshProviders();
    return { ok: true };
  });

  ipcMain.handle("assistant:updateSettings", async (_event, params: unknown) =>
    assistant.updateProviderSettings(settingsPatch(params as Params)),
  );

  ipcMain.handle("assistant:connectHermes", async (_event, params: unknown) => {
    const p = params as Params;
    const baseUrl = str(p?.baseUrl);
    const apiKey = str(p?.apiKey);
    if (!baseUrl || !apiKey) throw new Error("Base URL and API key are both required.");
    return assistant.connectHermes(baseUrl, apiKey);
  });

  ipcMain.handle("assistant:send", async (_event, params: unknown) => {
    const p = params as Params;
    const requestId = str(p?.requestId);
    const input = typeof p?.input === "string" ? p.input : "";
    const skill = p?.skill as Params;
    const skillName = str(skill?.name);
    if (!requestId || (!input.trim() && !skillName)) throw new Error("Nothing to send.");
    await assistant.sendTurn(providerOf(p), {
      requestId,
      input,
      sessionId: str(p?.sessionId) || undefined,
      title: str(p?.title) || undefined,
      previousResponseId: str(p?.previousResponseId) || undefined,
      skill: skillName ? { name: skillName, path: str(skill?.path) || undefined } : undefined,
    });
    return { ok: true };
  });

  ipcMain.handle("assistant:respondApproval", async (_event, params: unknown) => {
    const p = params as Params;
    const decision = p?.decision as ApprovalDecision;
    if (!["once", "session", "always", "deny"].includes(decision))
      throw new Error("Unknown decision.");
    await assistant.respondApproval(providerOf(p), str(p?.requestId), str(p?.approvalId), decision);
    return { ok: true };
  });

  ipcMain.handle("assistant:steer", async (_event, params: unknown) => {
    const p = params as Params;
    const input = typeof p?.input === "string" ? p.input : "";
    if (!input.trim()) throw new Error("Nothing to send.");
    return {
      accepted: await assistant.steerTurn(providerOf(p), str(p?.requestId), input),
    };
  });

  ipcMain.handle("assistant:cancel", async (_event, params: unknown) => {
    const p = params as Params;
    assistant.cancelTurn(providerOf(p), str(p?.requestId));
    return { ok: true };
  });

  ipcMain.handle("assistant:skills", async (_event, params: unknown) =>
    assistant.listSkills(providerOf(params as Params)),
  );

  ipcMain.handle("assistant:sessions", async (_event, params: unknown) => {
    const p = params as Params;
    const limit = typeof p?.limit === "number" && Number.isFinite(p.limit) ? p.limit : 40;
    return assistant.listSessions(providerOf(p), limit);
  });

  ipcMain.handle("assistant:sessionMessages", async (_event, params: unknown) => {
    const p = params as Params;
    return assistant.readSession(providerOf(p), sessionIdOf(p));
  });

  ipcMain.handle("assistant:deleteSession", async (_event, params: unknown) => {
    const p = params as Params;
    await assistant.deleteSession(providerOf(p), sessionIdOf(p));
    return { ok: true };
  });
}
