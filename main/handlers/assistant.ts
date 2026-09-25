/**
 * Assistant IPC: provider state/settings plus chat routing. Every call answers
 * well inside the 5s IPC budget — health checks and turns run in the
 * background and report via `assistant:providersChanged` / `assistant:chatEvent`.
 */

import { ipcMain } from "@glaze/core/backend";
import * as assistant from "../services/assistant/service.js";
import { PROVIDER_KINDS, type ProviderKind, type RuntimeMode } from "../services/assistant/types.js";

type Params = Record<string, unknown> | undefined;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

function providerOf(p: Params): ProviderKind {
  const kind = p?.provider;
  if (typeof kind === "string" && PROVIDER_KINDS.includes(kind as ProviderKind)) return kind as ProviderKind;
  throw new Error("Unknown assistant provider.");
}

function sessionIdOf(p: Params): string {
  const sessionId = str(p?.sessionId);
  if (!sessionId) throw new Error("A session id is required.");
  return sessionId;
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
  if (codex) {
    const c: NonNullable<assistant.SettingsPatch["codex"]> = {};
    if (bool(codex.enabled) !== undefined) c.enabled = bool(codex.enabled);
    for (const key of [
      "binaryPath",
      "homePath",
      "launchArgs",
      "model",
      "reasoningEffort",
      "serviceTier",
    ] as const) {
      if (typeof codex[key] === "string") c[key] = str(codex[key]);
    }
    if (codex.runtimeMode === "full-access" || codex.runtimeMode === "read-only")
      c.runtimeMode = codex.runtimeMode as RuntimeMode;
    patch.codex = c;
  }
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
