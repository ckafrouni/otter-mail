import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  ColorWell,
  Switch,
  toast,
} from "@glaze/core/components";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../gmail/select";
import {
  ArchiveXIcon,
  BookmarkIcon,
  ChevronRightIcon,
  FileIcon,
  InboxIcon,
  LayersIcon,
  PenLineIcon,
  PlusIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import {
  gmailApi,
  type ChatStatus,
  type MailApp,
  type NotificationsMode,
  type SettingsPane,
} from "../gmail/api";
import { useAccounts, useAddAccount, useRemoveAccount, useUpdateAccount } from "../gmail/hooks";
import { useMailViews } from "../gmail/custom-views";
import { RichTextArea, type RichTextRef } from "../gmail/rich-text";
import { ViewEditorForm } from "../gmail/view-editor-form";
import { getAccountColor, getAccountDisplayName } from "../gmail/account-style";
import type { GmailAccount, MailView } from "../gmail/types";
import {
  getAdvanceDirection,
  setAdvanceDirection as persistAdvanceDirection,
  type AdvanceDirection,
} from "../gmail/advance-direction";
import { Btn, IconBtn, cn } from "../gmail/ui";
import { AppearancePane } from "./appearance-pane";
import { KeybindingsPane } from "./keybindings-pane";
import { SettingsPageContainer, SettingsRow, SettingsSection, TextInput } from "./settings-ui";

/** Where the settings page is. */
export type SettingsRoute = {
  pane: SettingsPane;
  /** Views pane: a view id to edit, or "new" to create one. */
  viewId: string | null;
  /** For "new": which mailbox (account id or "__combined__") owns the view. */
  mailbox: string | null;
};

const NOTIFICATIONS_OPTIONS: { value: NotificationsMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "inbox", label: "Inbox only" },
  { value: "all", label: "All new mail" },
];

/** Auto-sync cadence choices in seconds; 0 = manual only. */
const SYNC_INTERVAL_OPTIONS = [
  { value: 0, label: "Manually" },
  { value: 15, label: "Every 15 seconds" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 900, label: "Every 15 minutes" },
];

const ADVANCE_DIRECTION_OPTIONS: { value: AdvanceDirection; label: string }[] = [
  { value: "next", label: "Next message" },
  { value: "previous", label: "Previous message" },
  { value: "none", label: "Don't select another message" },
];

const COMBINED_MAILBOX = "__combined__";

/** Compact select in the control slot of a row. */
function RowSelect({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="small"
        aria-label={ariaLabel}
        className={cn("w-full sm:w-44", className)}
      >
        <SelectValue placeholder={placeholder ?? "Loading…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralPane() {
  const [syncInterval, setSyncInterval] = useState<number | null>(null);
  const [notificationsMode, setNotificationsMode] = useState<NotificationsMode | null>(null);
  const [advanceDirection, setAdvanceDirectionState] = useState<AdvanceDirection>(() =>
    getAdvanceDirection(),
  );
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [trayEnabled, setTrayEnabled] = useState(true);
  const [mailApps, setMailApps] = useState<MailApp[]>([]);
  const [defaultMailBundleId, setDefaultMailBundleId] = useState<string | null>(null);

  const loadSyncSettings = async () => {
    console.log("[Settings:loadSyncSettings]");
    try {
      const settings = await gmailApi.getSyncSettings();
      setSyncInterval(settings.syncIntervalSeconds);
      setNotificationsMode(settings.notificationsMode);
      setLaunchAtLogin(settings.launchAtLogin);
      setTrayEnabled(settings.trayEnabled);
    } catch (error) {
      toast.error(`Failed to load sync settings: ${error}`);
    }
  };

  const loadMailApps = async () => {
    try {
      const result = await gmailApi.listMailApps();
      setMailApps(result.apps);
      setDefaultMailBundleId(result.defaultBundleId);
    } catch (error) {
      console.log("[Settings:listMailApps] failed", { error: String(error) });
    }
  };

  useEffect(() => {
    void loadSyncSettings();
    void loadMailApps();
  }, []);

  const handleSyncIntervalChange = async (value: string) => {
    const seconds = Number(value);
    setSyncInterval(seconds);
    console.log("[Settings:setSyncInterval]", { seconds });
    try {
      await gmailApi.setSyncSettings({ syncIntervalSeconds: seconds });
    } catch (error) {
      toast.error(`Failed to save sync setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleNotificationsModeChange = async (value: string) => {
    const mode = value as NotificationsMode;
    setNotificationsMode(mode);
    console.log("[Settings:setNotificationsMode]", { mode });
    try {
      await gmailApi.setSyncSettings({ notificationsMode: mode });
    } catch (error) {
      toast.error(`Failed to save notifications setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleAdvanceDirectionChange = (value: string) => {
    const direction = value as AdvanceDirection;
    console.log("[Settings:setAdvanceDirection]", { direction });
    setAdvanceDirectionState(direction);
    persistAdvanceDirection(direction);
  };

  const handleLaunchAtLoginChange = async (checked: boolean) => {
    setLaunchAtLogin(checked);
    console.log("[Settings:setLaunchAtLogin]", { checked });
    try {
      await gmailApi.setSyncSettings({ launchAtLogin: checked });
    } catch (error) {
      toast.error(`Failed to save launch-at-login setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleTrayEnabledChange = async (checked: boolean) => {
    setTrayEnabled(checked);
    console.log("[Settings:setTrayEnabled]", { checked });
    try {
      await gmailApi.setSyncSettings({ trayEnabled: checked });
    } catch (error) {
      toast.error(`Failed to save menu-bar icon setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleDefaultMailChange = async (bundleId: string) => {
    setDefaultMailBundleId(bundleId);
    console.log("[Settings:setDefaultMailApp]", { bundleId });
    try {
      await gmailApi.setDefaultMailApp(bundleId);
    } catch (error) {
      toast.error(`Failed to change default mail app: ${error}`);
    }
    // macOS may still put a consent dialog in the way — re-read the actual
    // state rather than trusting the optimistic selection.
    void loadMailApps();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Startup & menu bar">
        <SettingsRow
          title="Launch at login"
          description="Open Otter Mail automatically when you log in to your Mac."
          control={
            <Switch
              id="launchAtLogin"
              checked={launchAtLogin}
              onCheckedChange={(checked) => void handleLaunchAtLoginChange(checked)}
            />
          }
        />
        <SettingsRow
          title="Show menu-bar icon"
          description="An Otter Mail icon in the menu bar with a quick unread inbox view."
          control={
            <Switch
              id="trayEnabled"
              checked={trayEnabled}
              onCheckedChange={(checked) => void handleTrayEnabledChange(checked)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Mail">
        <SettingsRow
          title="Check for new mail"
          description="Sync runs in the background at this cadence."
          control={
            <RowSelect
              value={syncInterval != null ? String(syncInterval) : undefined}
              onValueChange={(v) => void handleSyncIntervalChange(v)}
              options={SYNC_INTERVAL_OPTIONS.map((o) => ({
                value: String(o.value),
                label: o.label,
              }))}
              ariaLabel="Check for new mail"
            />
          }
        />
        <SettingsRow
          title="Notifications"
          description="Notify about new mail found by background sync."
          control={
            <RowSelect
              value={notificationsMode ?? undefined}
              onValueChange={(v) => void handleNotificationsModeChange(v)}
              options={NOTIFICATIONS_OPTIONS}
              ariaLabel="Notifications"
            />
          }
        />
        <SettingsRow
          title="After archive, delete, or move"
          description="Which message to select next in the list."
          control={
            <RowSelect
              value={advanceDirection}
              onValueChange={handleAdvanceDirectionChange}
              options={ADVANCE_DIRECTION_OPTIONS}
              ariaLabel="After archive, delete, or move"
              className="sm:w-60"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="System">
        <SettingsRow
          title="Default email app"
          description="Which app opens mailto: links across macOS."
          control={
            <RowSelect
              value={defaultMailBundleId ?? undefined}
              onValueChange={(v) => void handleDefaultMailChange(v)}
              options={mailApps.map((app) => ({ value: app.bundleId, label: app.name }))}
              ariaLabel="Default email app"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function AccountRow({ account }: { account: GmailAccount }) {
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [name, setName] = useState(getAccountDisplayName(account));
  const [signatureOpen, setSignatureOpen] = useState(false);
  const signatureRef = useRef<RichTextRef>(null);

  useEffect(() => {
    setName(getAccountDisplayName(account));
  }, [account.id, account.displayName, account.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === getAccountDisplayName(account)) return;
    console.log("[Settings:renameAccount]", { accountId: account.id, name: trimmed });
    void updateAccount.mutateAsync({ accountId: account.id, displayName: trimmed });
  };

  const commitSignature = () => {
    const editor = signatureRef.current;
    if (!editor) return;
    const html = editor.getText().trim().length === 0 ? "" : editor.getHTML();
    if (html === (account.signature ?? "")) return;
    console.log("[Settings:updateSignature]", { accountId: account.id });
    void updateAccount.mutateAsync({ accountId: account.id, signature: html });
  };

  const color = getAccountColor(account);

  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar size="small">
            {account.picture ? <AvatarImage src={account.picture} alt={name} /> : null}
            <AvatarFallback>{(name[0] ?? "?").toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{getAccountDisplayName(account)}</span>
            <span className="truncate text-xs font-normal text-muted-foreground/80">
              {account.email}
            </span>
          </span>
        </span>
      }
      control={
        <div className="flex items-center gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label={`Display name for ${account.email}`}
            className="w-44"
          />
          <ColorWell
            value={color}
            onChange={(swatch) =>
              void updateAccount.mutateAsync({ accountId: account.id, color: swatch })
            }
            size="small"
            aria-label={`Set color for ${account.email}`}
            className="shrink-0"
          />
          {confirmingRemove ? (
            <>
              <Btn size="sm" variant="outline" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Btn>
              <Btn
                size="sm"
                variant="destructive"
                disabled={removeAccount.isPending}
                onClick={() => void removeAccount.mutateAsync(account.id)}
              >
                {removeAccount.isPending ? "Removing…" : "Remove"}
              </Btn>
            </>
          ) : (
            <IconBtn
              label={`Remove ${account.email}`}
              className="hover:text-destructive"
              onClick={() => setConfirmingRemove(true)}
            >
              <Trash2Icon className="size-4" />
            </IconBtn>
          )}
        </div>
      }
    >
      <div className="pb-2">
        <button
          type="button"
          onClick={() => setSignatureOpen((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <PenLineIcon className="size-3" />
          {account.signature ? "Edit signature" : "Add signature"}
          <ChevronRightIcon
            className={cn("size-3 transition-transform", signatureOpen && "rotate-90")}
          />
        </button>
        {signatureOpen ? (
          <div className="mt-2 rounded-lg border border-input bg-canvas dark:bg-input/32">
            <RichTextArea
              ref={signatureRef}
              placeholder="Your signature…"
              ariaLabel={`Signature for ${account.email}`}
              minHeightClass="min-h-[70px]"
              initialHTML={account.signature}
              onBlur={commitSignature}
            />
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}

function AccountsPane() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const addAccount = useAddAccount();
  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Gmail accounts"
        headerAction={
          <Btn
            size="xs"
            variant="outline"
            disabled={addAccount.isPending}
            onClick={() => void addAccount.mutateAsync().catch(() => {})}
          >
            <PlusIcon className="size-3.5" />
            {addAccount.isPending ? "Waiting for Google…" : "Add account"}
          </Btn>
        }
      >
        {accounts.length > 0 ? (
          accounts.map((account) => <AccountRow key={account.id} account={account} />)
        ) : (
          <SettingsRow
            title="No accounts yet"
            description="Add a Gmail account to start syncing mail."
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function viewIcon(view: MailView) {
  const cls = "size-4 text-muted-foreground";
  if (view.kind === "inbox") return <InboxIcon className={cls} />;
  if (view.kind === "starred") return <StarIcon className={cls} />;
  if (view.kind === "sent") return <SendIcon className={cls} />;
  if (view.kind === "drafts") return <FileIcon className={cls} />;
  if (view.kind === "important") return <BookmarkIcon className={cls} />;
  if (view.kind === "junk") return <ArchiveXIcon className={cls} />;
  if (view.kind === "trash") return <Trash2Icon className={cls} />;
  return <LayersIcon className={cls} />;
}

const BUILTIN_SUMMARY: Record<string, string> = {
  inbox: "Default — every account's Inbox",
  starred: "Default — every account's Starred",
  sent: "Default — every account's Sent",
  drafts: "Default — every account's Drafts",
  important: "Default — every account's Important",
  junk: "Default — every account's Junk",
  trash: "Default — every account's Trash",
};

function viewSummary(view: MailView): string {
  if (view.rules === null) return BUILTIN_SUMMARY[view.kind] ?? "Default";
  const labels = view.rules.reduce((n, r) => n + r.allOf.length + r.noneOf.length, 0);
  const accounts = view.rules.length;
  return `${labels} filter${labels === 1 ? "" : "s"} across ${accounts} account${accounts === 1 ? "" : "s"}`;
}

function ViewsPane({
  editingId,
  editingMailbox,
  onOpenView,
  onDone,
}: {
  editingId: string | null;
  editingMailbox: string | null;
  onOpenView: (viewId: string, mailbox: string) => void;
  onDone: () => void;
}) {
  const { views, saveView, deleteView, resetView } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  if (editingId) {
    if (!accountsQuery.data) {
      return (
        <SettingsPageContainer>
          <p className="text-sm text-muted-foreground">Loading accounts…</p>
        </SettingsPageContainer>
      );
    }
    const editingView =
      editingId === "new" ? null : (views.find((v) => v.id === editingId) ?? null);
    const mailbox = editingView
      ? (editingView.mailbox ?? COMBINED_MAILBOX)
      : (editingMailbox ?? COMBINED_MAILBOX);
    // Account-owned views edit against that account's labels only.
    const scopedAccounts =
      mailbox === COMBINED_MAILBOX ? accounts : accounts.filter((a) => a.id === mailbox);
    return (
      <SettingsPageContainer>
        <ViewEditorForm
          key={editingId}
          view={editingView}
          accounts={scopedAccounts}
          onSave={(input) => saveView({ ...input, mailbox })}
          onDelete={deleteView}
          onReset={resetView}
          onDone={onDone}
        />
      </SettingsPageContainer>
    );
  }

  // One section per mailbox: Combined first (it's a mailbox too), then
  // accounts. Built-ins are fixed system mailboxes — only custom views list.
  const sections: { id: string; title: string; subtitle: string; views: MailView[] }[] = [
    ...(accounts.length > 1
      ? [
          {
            id: COMBINED_MAILBOX,
            title: "All mailboxes",
            subtitle: "Views across every account",
            views: views.filter(
              (v) => v.kind === "custom" && (v.mailbox ?? COMBINED_MAILBOX) === COMBINED_MAILBOX,
            ),
          },
        ]
      : []),
    ...accounts.map((a) => ({
      id: a.id,
      title: getAccountDisplayName(a),
      subtitle: a.email,
      views: views.filter((v) => v.kind === "custom" && v.mailbox === a.id),
    })),
  ];

  return (
    <SettingsPageContainer>
      {sections.map((section) => (
        <SettingsSection
          key={section.id}
          title={section.title}
          headerAction={
            <Btn size="xs" variant="outline" onClick={() => onOpenView("new", section.id)}>
              <PlusIcon className="size-3.5" />
              New view
            </Btn>
          }
        >
          {section.views.length > 0 ? (
            section.views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => onOpenView(view.id, section.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent-surface/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring sm:px-4"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {viewIcon(view)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {view.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground/80">
                    {viewSummary(view)}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-icon-muted" />
              </button>
            ))
          ) : (
            <SettingsRow title="No views yet" description={section.subtitle} />
          )}
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

function AssistantPane() {
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatSaving, setChatSaving] = useState(false);

  const loadChatStatus = async () => {
    try {
      setChatStatus(await gmailApi.chatStatus());
    } catch (error) {
      console.log("[Settings:chatStatus] failed", { error: String(error) });
    }
  };
  useEffect(() => {
    void loadChatStatus();
  }, []);

  const handleChatSave = async () => {
    if (!chatBaseUrl.trim() || !chatApiKey.trim()) {
      toast.error("API base URL and key are both required");
      return;
    }
    setChatSaving(true);
    console.log("[Settings:chatConfigure]");
    try {
      const status = await gmailApi.chatConfigure({
        baseUrl: chatBaseUrl.trim(),
        apiKey: chatApiKey.trim(),
      });
      setChatStatus(status);
      setChatBaseUrl("");
      setChatApiKey("");
      toast.success(`Hermes chat connected (${status.model ?? "agent"})`);
    } catch (error) {
      toast.error(`Could not connect: ${error}`);
    } finally {
      setChatSaving(false);
    }
  };

  const chatStatusLine = chatStatus?.configured ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-success" aria-hidden />
      Connected to {chatStatus.baseUrl} ({chatStatus.model}) ·{" "}
      {chatStatus.sessions
        ? "native sessions: chats persist on Hermes."
        : "no Sessions API; chats chain by response id."}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
      Not connected
    </span>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Hermes chat">
        <SettingsRow
          title="API server"
          description="The chat panel talks to Hermes' built-in API server (port 8642) over Tailscale."
          status={chatStatusLine}
        />
        <SettingsRow
          title="Base URL"
          control={
            <TextInput
              value={chatBaseUrl}
              onChange={(e) => setChatBaseUrl(e.target.value)}
              placeholder={chatStatus?.baseUrl ?? "https://<host>:8642"}
              aria-label="Hermes API base URL"
              className="sm:w-64"
            />
          }
        />
        <SettingsRow
          title="API key"
          description="The server's API_SERVER_KEY. Stored encrypted on this Mac."
          control={
            <TextInput
              type="password"
              value={chatApiKey}
              onChange={(e) => setChatApiKey(e.target.value)}
              placeholder={chatStatus?.configured ? "Replace API key" : "API key"}
              aria-label="Hermes API key"
              className="sm:w-64"
            />
          }
        />
        <SettingsRow
          title={chatStatus?.configured ? "Reconnect" : "Connect"}
          description="Verifies the URL and key against the server, then saves them."
          control={
            <Btn
              size="sm"
              variant="primary"
              disabled={chatSaving}
              onClick={() => void handleChatSave()}
            >
              {chatSaving ? "Connecting…" : chatStatus?.configured ? "Reconnect" : "Connect"}
            </Btn>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** In-app settings: one pane at a time, chosen from the sidebar nav. */
export function SettingsPage({
  route,
  onNavigate,
}: {
  route: SettingsRoute;
  onNavigate: (route: SettingsRoute) => void;
}) {
  if (route.pane === "appearance") return <AppearancePane />;
  if (route.pane === "keybindings") return <KeybindingsPane />;
  if (route.pane === "accounts") return <AccountsPane />;
  if (route.pane === "assistant") return <AssistantPane />;
  if (route.pane === "views") {
    return (
      <ViewsPane
        editingId={route.viewId}
        editingMailbox={route.mailbox}
        onOpenView={(viewId, mailbox) => onNavigate({ pane: "views", viewId, mailbox })}
        onDone={() => onNavigate({ pane: "views", viewId: null, mailbox: null })}
      />
    );
  }
  return <GeneralPane />;
}
