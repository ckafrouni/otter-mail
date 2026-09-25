/**
 * Settings → Assistant, laid out like T3 Code's provider settings: a toolbar
 * with "Checked … ago" refresh, then one card split into the provider list
 * (icon, name, version, status, enable switch) and the selected provider's
 * editor.
 */

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { toast, Switch } from "@glaze/core/components";
import { CheckIcon, RotateCwIcon, StarIcon } from "lucide-react";
import {
  gmailApi,
  type AssistantSettingsPatch,
  type ProviderKind,
  type ProviderModel,
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
import { RUNTIME_MODE_OPTIONS } from "../gmail/model-picker";
import {
  modelKey,
  setHidden,
  toggleAllHidden,
  toggleFavorite,
  useModelPrefs,
} from "../gmail/model-prefs";
import {
  setFollowUpBehavior,
  useFollowUpBehavior,
  type FollowUpBehavior,
} from "../gmail/chat-queue";

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
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_DOT[status])}
      aria-hidden
    />
  );
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
            <span className="truncate text-sm font-medium text-foreground">
              {provider.displayName}
            </span>
            {version ? (
              <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                {version}
              </code>
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
      {summary.detail ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">· {summary.detail}</span>
      ) : null}
    </div>
  );
}

/** T3's capability summary for a row: "Reasoning · Fast". */
function capabilityLabels(model: ProviderModel): string[] {
  return (model.options ?? []).map((o) => (o.id === "serviceTier" ? "Fast" : o.label));
}

/**
 * Models, as T3 Code's ProviderModelsSection: favorites and picker visibility
 * (stored on this Mac), a filter for long catalogs, and Enable / Disable all.
 * Clicking a name makes it the provider's default model.
 */
function ModelsSection({
  provider,
  onPick,
}: {
  provider: ProviderSnapshot;
  onPick?: (slug: string) => void;
}) {
  const { favorites, hidden } = useModelPrefs();
  const [filter, setFilter] = useState("");
  const key = (slug: string) => modelKey(provider.kind, slug);
  const favoriteSet = new Set(favorites);
  const hiddenSet = new Set(hidden);
  const groupOf = (m: ProviderModel) =>
    favoriteSet.has(key(m.slug)) ? "favorite" : hiddenSet.has(key(m.slug)) ? "hidden" : "visible";
  const rank = { favorite: 0, visible: 1, hidden: 2 } as const;
  const models = provider.models;
  const query = filter.trim().toLowerCase();
  const visible = models
    .filter(
      (m) =>
        !query ||
        m.name.toLowerCase().includes(query) ||
        m.slug.toLowerCase().includes(query) ||
        (m.subProvider ?? "").toLowerCase().includes(query),
    )
    .sort((a, b) => rank[groupOf(a)] - rank[groupOf(b)]);
  const favoriteCount = models.filter((m) => favoriteSet.has(key(m.slug))).length;
  const hiddenCount = models.filter((m) => hiddenSet.has(key(m.slug))).length;
  const allKeys = models.map((m) => key(m.slug));
  const allHidden = allKeys.length > 0 && allKeys.every((k) => hiddenSet.has(k));

  const groupLabel = (label: string, isFirst: boolean) => (
    <div className={cn("px-2 pb-1.5 text-2xs text-muted-foreground", isFirst ? "pt-1" : "pt-5")}>
      {label}
    </div>
  );

  return (
    <SettingsSection title="Models">
      <div className="px-3 py-3 sm:px-4">
        <p className="mb-3 text-xs text-muted-foreground">
          Favorites and visibility are saved on this Mac.
          {onPick ? " Click a model to make it the default for new chats." : ""}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {models.length > 8 ? (
            <TextInput
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models"
              spellCheck={false}
              aria-label="Filter models"
              className="w-56 max-w-full"
            />
          ) : null}
          <div className="flex items-center gap-2">
            {models.length > 0 ? (
              <Btn size="xs" variant="ghost-muted" onClick={() => toggleAllHidden(allKeys)}>
                {allHidden ? "Enable all" : "Disable all"}
              </Btn>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {models.length} model{models.length === 1 ? "" : "s"}
              {favoriteCount > 0
                ? ` · ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}`
                : ""}
              {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
            </span>
          </div>
        </div>
        <div className="-mx-2 mt-2 max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {query ? "No models match." : "No models reported for this provider yet."}
            </p>
          ) : null}
          {visible.map((m, index) => {
            const group = groupOf(m);
            const previous = visible[index - 1];
            const startsGroup = !previous || groupOf(previous) !== group;
            const isHidden = hiddenSet.has(key(m.slug));
            const isFavorite = group === "favorite";
            const isDefault = m.slug === provider.model;
            const caps = capabilityLabels(m);
            return (
              <div key={m.slug}>
                {startsGroup && favoriteCount > 0 && group === "favorite"
                  ? groupLabel("Favorites", index === 0)
                  : null}
                {startsGroup && favoriteCount > 0 && group === "visible"
                  ? groupLabel("All", index === 0)
                  : null}
                {startsGroup && group === "hidden"
                  ? groupLabel("Hidden from picker", index === 0)
                  : null}
                <div
                  data-model-slug={m.slug}
                  className={cn(
                    "grid h-7 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 transition-colors hover:bg-muted/30",
                    isHidden && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleFavorite(key(m.slug))}
                    aria-label={`${isFavorite ? "Remove" : "Add"} ${m.name} ${isFavorite ? "from" : "to"} favorites`}
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent-surface hover:text-foreground"
                  >
                    <StarIcon
                      className={cn("size-3", isFavorite && "fill-current text-yellow-500")}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={!onPick}
                    onClick={() => onPick?.(m.slug)}
                    className="flex min-w-0 items-baseline gap-2 text-left enabled:cursor-pointer"
                  >
                    <span
                      className={cn(
                        "truncate text-xs",
                        isHidden ? "text-muted-foreground" : "text-foreground/90",
                      )}
                    >
                      {m.name}
                    </span>
                    {m.subProvider ? (
                      <span className="truncate text-2xs text-muted-foreground/70">
                        {m.subProvider}
                      </span>
                    ) : m.name !== m.slug && m.slug ? (
                      <code className="truncate font-mono text-2xs text-muted-foreground/70">
                        {m.slug}
                      </code>
                    ) : null}
                    {isDefault ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-foreground/80">
                        <CheckIcon className="size-3" />
                        default
                      </span>
                    ) : null}
                  </button>
                  <span className="text-2xs text-muted-foreground/70">
                    {caps.length > 0 ? (
                      <span className="hidden sm:inline">{caps.join(" · ")}</span>
                    ) : null}
                  </span>
                  <span
                    className="flex shrink-0 items-center"
                    title={isHidden ? "Hidden from the model picker" : "Shown in the model picker"}
                  >
                    <Switch
                      checked={!isHidden}
                      onCheckedChange={(checked: boolean) => setHidden(key(m.slug), !checked)}
                      aria-label={`Show ${m.name} in the model picker`}
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
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
      headerAction={
        version ? <code className="text-xs text-muted-foreground">{version}</code> : null
      }
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

/** Runtime fields of the CLI-backed agents, per T3's provider settings. */
const AGENT_RUNTIME = {
  codex: {
    name: "Codex",
    binary: "codex",
    home: {
      title: "CODEX_HOME path",
      description: "Custom Codex home and config directory.",
      placeholder: "~/.codex",
    },
    launchArgs: "Additional CLI arguments passed to codex app-server on session start.",
  },
  claude: {
    name: "Claude",
    binary: "claude",
    home: {
      title: "CLAUDE_CONFIG_DIR path",
      description: "Custom Claude config directory.",
      placeholder: "~/.claude",
    },
    launchArgs: null,
  },
} as const;

function AgentEditor({
  kind,
  state,
  provider,
  update,
}: {
  kind: "codex" | "claude";
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AssistantSettingsPatch) => void;
}) {
  const meta = AGENT_RUNTIME[kind];
  const settings = state.settings[kind];
  const set = (patch: Record<string, string>) => update({ [kind]: patch });
  return (
    <>
      <SettingsSection title="Runtime">
        <SettingsRow
          title="Binary path"
          description={`Path to the ${meta.name} binary. Empty uses \`${meta.binary}\` from your shell's PATH.`}
          control={
            <DraftInput
              value={settings.binaryPath}
              onCommit={(binaryPath) => set({ binaryPath })}
              placeholder={meta.binary}
              aria-label={`${meta.name} binary path`}
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title={meta.home.title}
          description={meta.home.description}
          control={
            <DraftInput
              value={settings.homePath}
              onCommit={(homePath) => set({ homePath })}
              placeholder={meta.home.placeholder}
              aria-label={meta.home.title}
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        {meta.launchArgs && kind === "codex" ? (
          <SettingsRow
            title="Launch arguments"
            description={meta.launchArgs}
            control={
              <DraftInput
                value={state.settings.codex.launchArgs}
                onCommit={(launchArgs) => set({ launchArgs })}
                placeholder="e.g. -c key=value"
                aria-label={`${meta.name} launch arguments`}
                className="font-mono @min-[32rem]/settings-row:w-56"
              />
            }
          />
        ) : null}
        <SettingsRow
          title="Access"
          description="Default for new turns; also switchable from the composer (⇧⌘A)."
          control={
            <Select
              value={settings.runtimeMode}
              onValueChange={(value) => set({ runtimeMode: value as RuntimeMode })}
            >
              <SelectTrigger
                size="small"
                aria-label={`${meta.name} access`}
                className="w-full sm:w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_MODE_OPTIONS.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
      <ModelsSection provider={provider} onPick={(model) => set({ model })} />
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
    gmailApi
      .updateAssistantSettings(patch)
      .then(setState, (error: unknown) =>
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
  const current =
    providers.find((p) => p.kind === (selectedKind ?? state.selected)) ?? providers[0];
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
                    Checked{" "}
                    <span className="font-mono tabular-nums">{formatAgo(now - lastChecked)}</span>
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
                <AgentEditor kind={current.kind} state={state} provider={current} update={update} />
              )}
            </div>
          </div>
        </SettingsGroup>

        <div className="pt-6">
          <FollowUpSection />
        </div>
      </div>
    </div>
  );
}

/** T3's "Follow-up behavior": what Enter does while the agent is working. */
function FollowUpSection() {
  const behavior = useFollowUpBehavior();
  return (
    <SettingsSection title="Chat">
      <SettingsRow
        title="Follow-up behavior"
        description="Queue follow-ups while the agent runs or steer the current run. Press ⌘ + Enter to do the opposite for one message."
        control={
          <Select
            value={behavior}
            onValueChange={(value) => setFollowUpBehavior(value as FollowUpBehavior)}
          >
            <SelectTrigger size="small" aria-label="Follow-up behavior" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="queue">Queue</SelectItem>
              <SelectItem value="steer">Steer</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingsSection>
  );
}
