/**
 * Settings → Assistant, laid out like T3 Code's provider settings: a toolbar
 * with "Checked … ago" refresh, then one card split into the provider list
 * (icon, name, version, status, enable switch) and the selected provider's
 * editor.
 */

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { toast, Switch } from "@glaze/core/components";
import { CheckIcon, RotateCwIcon } from "lucide-react";
import {
  gmailApi,
  type AssistantSettingsPatch,
  type ProviderKind,
  type ProviderSnapshot,
  type ProvidersState,
  type RuntimeMode,
} from "../gmail/api";
import {
  PROVIDER_STATUS_DOT,
  ProviderIcon,
  providerSummary,
  providerVersionLabel,
  useAssistantProviders,
  useSetProvidersState,
} from "../gmail/assistant-providers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../gmail/select";
import { Btn, cn } from "../gmail/ui";
import { SettingsGroup, SettingsRow, SettingsSection, TextInput } from "./settings-ui";

const CARD_HEIGHT =
  "@min-[48rem]/providers:h-[min(44rem,calc(100dvh-9rem))] @min-[48rem]/providers:min-h-[32rem]";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function StatusDot({ status }: { status: ProviderSnapshot["status"] }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_DOT[status])} aria-hidden />;
}

/** Text input that commits on blur / Enter (settings write once, not per keystroke). */
function DraftInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof TextInput>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <TextInput
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ProviderListRow({
  provider,
  selected,
  isDefault,
  onSelect,
  onToggle,
}: {
  provider: ProviderSnapshot;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const summary = providerSummary(provider);
  const version = providerVersionLabel(provider.version);
  const needsAttention = provider.status === "warning" || provider.status === "error";
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "group flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <div
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 items-start gap-3 rounded-md text-left transition-opacity",
          !provider.enabled && !selected && "opacity-60 group-hover:opacity-100",
        )}
      >
        <button
          type="button"
          className="pointer-events-auto absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          onClick={onSelect}
          aria-label={`Select ${provider.displayName}`}
          aria-pressed={selected}
        />
        <span className="flex size-5 shrink-0 items-center justify-center">
          <ProviderIcon kind={provider.kind} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{provider.displayName}</span>
            {version ? (
              <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{version}</code>
            ) : null}
            {isDefault ? (
              <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-3xs text-muted-foreground">
                Default
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-start gap-1.5 text-xs leading-normal text-muted-foreground/80">
            {needsAttention ? (
              <span className="flex h-[1.45em] shrink-0 items-center">
                <StatusDot status={provider.status} />
              </span>
            ) : null}
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{summary.headline}</span>
          </span>
        </span>
      </div>
      <span className="flex h-5 shrink-0 items-center">
        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked: boolean) => onToggle(Boolean(checked))}
          aria-label={`Enable ${provider.displayName}`}
        />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function StatusLine({ provider }: { provider: ProviderSnapshot }) {
  const summary = providerSummary(provider);
  if (provider.enabled && provider.auth.status === "authenticated" && provider.auth.email) {
    return (
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span>Authenticated as</span>
        <span className="text-foreground/80">{provider.auth.email}</span>
        {provider.auth.label ? <span>· {provider.auth.label}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      <StatusDot status={provider.status} />
      <span>{summary.headline}</span>
      {summary.detail ? <span className="min-w-0 [overflow-wrap:anywhere]">· {summary.detail}</span> : null}
    </div>
  );
}

function ModelsSection({
  provider,
  onPick,
}: {
  provider: ProviderSnapshot;
  onPick?: (slug: string) => void;
}) {
  return (
    <SettingsSection title="Models">
      <div className="px-3 py-3 sm:px-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {onPick
            ? "New chats use the checked model. Reported live by the provider; also pickable from the composer (⇧⌘M)."
            : "Reported by the agent's API server."}
        </p>
        {provider.models.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No models reported for this provider yet.</p>
        ) : (
          <div className="flex flex-col">
            {provider.models.map((m) => {
              const active = m.slug === provider.model;
              return (
                <button
                  key={m.slug}
                  type="button"
                  disabled={!onPick}
                  onClick={() => onPick?.(m.slug)}
                  className="grid h-7 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left enabled:cursor-pointer enabled:hover:bg-muted/30"
                >
                  <span className="flex items-center justify-center">
                    {active ? <CheckIcon className="size-3.5 text-foreground" /> : null}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-xs text-foreground/90">{m.name}</span>
                    {m.subProvider ? (
                      <span className="truncate text-2xs text-muted-foreground/70">{m.subProvider}</span>
                    ) : null}
                    {m.name !== m.slug && !m.subProvider ? (
                      <code className="truncate font-mono text-2xs text-muted-foreground/70">{m.slug}</code>
                    ) : null}
                  </span>
                  <span className="text-2xs text-muted-foreground">{m.isDefault ? "default" : ""}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function EditorHeader({
  provider,
  isDefault,
  onMakeDefault,
  children,
}: {
  provider: ProviderSnapshot;
  isDefault: boolean;
  onMakeDefault: () => void;
  children?: ReactNode;
}) {
  const version = providerVersionLabel(provider.version);
  return (
    <SettingsSection
      title={provider.displayName}
      icon={<ProviderIcon kind={provider.kind} className="size-4" />}
      headerAction={version ? <code className="text-xs text-muted-foreground">{version}</code> : null}
    >
      <SettingsRow
        title="Status"
        status={<StatusLine provider={provider} />}
        control={
          isDefault ? (
            <span className="text-xs text-muted-foreground">Used for new chats</span>
          ) : (
            <Btn size="sm" disabled={!provider.enabled} onClick={onMakeDefault}>
              Use for new chats
            </Btn>
          )
        }
      />
      {children}
    </SettingsSection>
  );
}

function HermesEditor({
  state,
  provider,
  update,
}: {
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AssistantSettingsPatch) => void;
}) {
  const setState = useSetProvidersState();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const connected = Boolean(state.settings.hermes.baseUrl && state.settings.hermesHasKey);

  const connect = async () => {
    const url = baseUrl.trim() || state.settings.hermes.baseUrl;
    if (!url || !apiKey.trim()) {
      toast.error("API base URL and key are both required");
      return;
    }
    setSaving(true);
    console.log("[Settings:connectHermes]");
    try {
      setState(await gmailApi.connectHermes({ baseUrl: url, apiKey: apiKey.trim() }));
      setBaseUrl("");
      setApiKey("");
      toast.success("Hermes connected");
    } catch (error) {
      toast.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsSection title="Connection">
        <SettingsRow
          title="Base URL"
          description="Hermes' built-in API server (port 8642), reached over Tailscale."
          control={
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={state.settings.hermes.baseUrl || "https://<host>:8642"}
              aria-label="Hermes API base URL"
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="API key"
          description="The server's API_SERVER_KEY. Stored encrypted on this Mac."
          control={
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={state.settings.hermesHasKey ? "Replace API key" : "API key"}
              aria-label="Hermes API key"
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title={connected ? "Reconnect" : "Connect"}
          description="Verifies the URL and key against the server, then saves them."
          control={
            <Btn size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : connected ? "Reconnect" : "Connect"}
            </Btn>
          }
        />
      </SettingsSection>
      <ModelsSection
        provider={provider}
        onPick={provider.models.length > 1 ? (model) => update({ hermes: { model } }) : undefined}
      />
    </>
  );
}

const RUNTIME_MODES: { value: RuntimeMode; label: string }[] = [
  { value: "full-access", label: "Full access" },
  { value: "read-only", label: "Read-only" },
];

function CodexEditor({
  state,
  provider,
  update,
}: {
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AssistantSettingsPatch) => void;
}) {
  const codex = state.settings.codex;
  const setCodex = (patch: NonNullable<AssistantSettingsPatch["codex"]>) => update({ codex: patch });
  return (
    <>
      <SettingsSection title="Runtime">
        <SettingsRow
          title="Binary path"
          description="Path to the Codex binary. Empty uses `codex` from your shell's PATH."
          control={
            <DraftInput
              value={codex.binaryPath}
              onCommit={(binaryPath) => setCodex({ binaryPath })}
              placeholder="codex"
              aria-label="Codex binary path"
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="CODEX_HOME path"
          description="Custom Codex home and config directory."
          control={
            <DraftInput
              value={codex.homePath}
              onCommit={(homePath) => setCodex({ homePath })}
              placeholder="~/.codex"
              aria-label="CODEX_HOME path"
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="Launch arguments"
          description="Additional CLI arguments passed to codex app-server on session start."
          control={
            <DraftInput
              value={codex.launchArgs}
              onCommit={(launchArgs) => setCodex({ launchArgs })}
              placeholder="e.g. -c key=value"
              aria-label="Codex launch arguments"
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="Access"
          description="Full access lets Codex run tools like gog against your mail; read-only keeps its sandbox from writing anything."
          control={
            <Select
              value={codex.runtimeMode}
              onValueChange={(value) => setCodex({ runtimeMode: value as RuntimeMode })}
            >
              <SelectTrigger size="small" aria-label="Codex access" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
      <ModelsSection provider={provider} onPick={(model) => setCodex({ model })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

export function ProvidersPane() {
  const query = useAssistantProviders();
  const setState = useSetProvidersState();
  const state = query.data;
  const [selectedKind, setSelectedKind] = useState<ProviderKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(1000);

  const update = (patch: AssistantSettingsPatch) => {
    console.log("[Settings:updateAssistant]", patch);
    gmailApi.updateAssistantSettings(patch).then(setState, (error: unknown) =>
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
    );
  };

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void gmailApi.refreshAssistantProviders().catch(() => {});
    // Results arrive as broadcasts; keep the spinner up while the probes run.
    setTimeout(() => setRefreshing(false), 1500);
  };

  if (!state) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="p-8 text-sm text-muted-foreground">
          {query.isError ? "Provider settings are unavailable." : "Loading provider settings…"}
        </p>
      </div>
    );
  }

  const providers = state.providers;
  const current = providers.find((p) => p.kind === (selectedKind ?? state.selected)) ?? providers[0];
  const lastChecked = Math.max(0, ...providers.map((p) => p.checkedAt ?? 0));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container/providers mx-auto w-full max-w-5xl space-y-2.5 px-4 pb-16 pt-4 sm:px-6">
        <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 sm:px-4">
          <h2 className="text-sm font-normal text-foreground/70">Providers</h2>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <Btn
              size="xs"
              variant="ghost-muted"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={refresh}
              title="Refresh provider status"
            >
              <RotateCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
              <span className="sr-only">Refresh provider status</span>
              <span className="hidden min-w-0 truncate sm:inline">
                {refreshing ? (
                  "Refreshing providers"
                ) : lastChecked ? (
                  <>
                    Checked <span className="font-mono tabular-nums">{formatAgo(now - lastChecked)}</span>
                  </>
                ) : (
                  "Checking…"
                )}
              </span>
            </Btn>
          </div>
        </div>

        <SettingsGroup
          divided={false}
          className={cn(
            CARD_HEIGHT,
            "overflow-hidden @min-[48rem]/providers:grid @min-[48rem]/providers:grid-cols-[17rem_minmax(0,1fr)]",
          )}
        >
          <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/providers:flex @min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-col @min-[48rem]/providers:border-r @min-[48rem]/providers:border-b-0">
            <div className="divide-y divide-border/50 @min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-1 @min-[48rem]/providers:overflow-y-auto">
              {providers.map((p) => (
                <ProviderListRow
                  key={p.kind}
                  provider={p}
                  selected={p.kind === current.kind}
                  isDefault={p.kind === state.selected}
                  onSelect={() => setSelectedKind(p.kind)}
                  onToggle={(enabled) => update({ [p.kind]: { enabled } })}
                />
              ))}
            </div>
          </div>
          <div className="min-w-0 @min-[48rem]/providers:min-h-0 @min-[48rem]/providers:overflow-y-auto">
            <div className="space-y-6 p-4">
              <EditorHeader
                provider={current}
                isDefault={current.kind === state.selected}
                onMakeDefault={() => update({ selected: current.kind })}
              />
              {current.kind === "hermes" ? (
                <HermesEditor state={state} provider={current} update={update} />
              ) : (
                <CodexEditor state={state} provider={current} update={update} />
              )}
            </div>
          </div>
        </SettingsGroup>
      </div>
    </div>
  );
}
