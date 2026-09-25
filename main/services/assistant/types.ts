/**
 * Assistant provider contracts shared by the backend and (mirrored in
 * renderer/main/gmail/api.ts) the renderer. Modelled on T3 Code's provider
 * layer: a *snapshot* describes a provider's health, a *provider* runs chat
 * turns, and every provider streams the same canonical {@link ChatEvent}s.
 */

export type ProviderKind = "hermes" | "codex";

export const PROVIDER_KINDS: readonly ProviderKind[] = ["hermes", "codex"];

export type ProviderState = "ready" | "warning" | "error" | "disabled";

export type ProviderAuth = {
  status: "authenticated" | "unauthenticated" | "unknown";
  /** e.g. "ChatGPT Pro" or the Hermes model id. */
  label?: string;
  email?: string;
};

/** One choice of a model option (a reasoning effort, a service tier). */
export type ProviderOptionChoice = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};

/** A per-model option the composer offers, like T3's option descriptors. */
export type ProviderModelOption = {
  id: "reasoningEffort" | "serviceTier";
  label: string;
  choices: ProviderOptionChoice[];
};

export type ProviderModel = {
  slug: string;
  name: string;
  /** Upstream provider behind an aggregating agent (Hermes: "OpenRouter"). */
  subProvider?: string;
  isDefault?: boolean;
  options?: ProviderModelOption[];
};

/** Health snapshot of one provider, as shown in Settings and the composer. */
export type ProviderSnapshot = {
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  /** The CLI could be started / the server answered. */
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: ProviderAuth;
  /** Epoch ms of the last check; null while the first check runs. */
  checkedAt: number | null;
  message?: string;
  models: ProviderModel[];
  /** Model new turns use (settings choice, else the provider default). */
  model: string | null;
  /** Chats persist on the provider and can be listed/resumed. */
  sessions: boolean;
};

/** Everything the renderer needs for the provider picker and settings. */
export type ProvidersState = {
  providers: ProviderSnapshot[];
  /** Provider new chats start with. */
  selected: ProviderKind;
  settings: ProviderSettingsView;
};

export type RuntimeMode = "full-access" | "read-only";

export type HermesSettings = {
  enabled: boolean;
  baseUrl: string;
  /** The agent's virtual model id from /v1/models (Responses API). */
  agentModel: string;
  /** Chosen `provider::model`; empty → the gateway's default model. */
  model: string;
  /** Empty → the gateway's configured default. */
  reasoningEffort: string;
  /** Empty / "default" → standard speed. */
  serviceTier: string;
  /** Whether the server exposes the native Sessions API (probed at connect). */
  sessions?: boolean;
};

export type CodexSettings = {
  enabled: boolean;
  /** Empty → `codex` on the login shell's PATH. */
  binaryPath: string;
  /** Empty → Codex's default (~/.codex). */
  homePath: string;
  /** Extra arguments after `codex app-server`. */
  launchArgs: string;
  /** Empty → the model Codex marks as default. */
  model: string;
  /** Empty → the model's default effort. */
  reasoningEffort: string;
  /** Empty / "default" → standard speed. */
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export type ProviderSettings = {
  selected: ProviderKind;
  hermes: HermesSettings;
  codex: CodexSettings;
};

/** Settings as the renderer sees them: Hermes' API key never leaves the backend. */
export type ProviderSettingsView = ProviderSettings & { hermesHasKey: boolean };

/** Canonical stream events, one contract for every provider. */
export type ChatEvent =
  | { requestId: string; type: "session"; sessionId: string }
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "tool"; name: string }
  | { requestId: string; type: "toolResult"; output: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

export type Emit = (event: ChatEvent) => void;

export type Skill = {
  name: string;
  description: string;
  category: string | null;
  /** Codex invokes skills by path. */
  path?: string;
};

/** A persisted provider-side chat (Hermes session / Codex thread). */
export type ChatSession = {
  id: string;
  title: string | null;
  source: string;
  /** Epoch ms. */
  lastActive: number;
  messageCount: number;
  preview: string | null;
};

/** One transcript row of a session, flattened for the panel. */
export type ChatSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCalls?: string[];
};

export type SendTurnInput = {
  requestId: string;
  input: string;
  /** Provider-side session to continue; omitted → the provider starts one and emits `session`. */
  sessionId?: string;
  /** Title for a new session. */
  title?: string;
  skill?: { name: string; path?: string };
  /** Hermes legacy chats: chain via the Responses API. */
  previousResponseId?: string;
};

/**
 * One provider. `checkStatus` probes health; the session methods exist only
 * when the provider keeps chats server-side.
 */
export interface ChatProvider {
  readonly kind: ProviderKind;
  readonly displayName: string;
  checkStatus(settings: ProviderSettings): Promise<Omit<ProviderSnapshot, "checkedAt" | "enabled">>;
  /** Runs one turn to completion, reporting progress through `emit`. */
  sendTurn(input: SendTurnInput, settings: ProviderSettings, emit: Emit): Promise<void>;
  cancel(requestId: string): void;
  listSkills(settings: ProviderSettings): Promise<Skill[]>;
  listSessions(settings: ProviderSettings, limit: number): Promise<ChatSession[]>;
  readSession(settings: ProviderSettings, sessionId: string): Promise<ChatSessionMessage[]>;
  deleteSession(settings: ProviderSettings, sessionId: string): Promise<void>;
  /** Stop background processes (settings changed, app quitting). */
  shutdown(): void;
}
