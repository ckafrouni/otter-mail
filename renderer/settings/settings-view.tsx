import { useEffect, useState } from "react";
import {
  ArchiveXIcon,
  BookmarkIcon,
  ChevronRightIcon,
  FileIcon,
  InboxIcon,
  KeyRoundIcon,
  LayersIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import {
  Label,
  List,
  NavigationButtonGroup,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sidebar,
  SidebarList,
  SidebarListItem,
  SidebarListItemContent,
  SidebarListItemTitle,
  SplitView,
  Toolbar,
  ToolbarTitle,
  Field,
  FieldSet,
  Input,
  Button,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Text,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import { gmailApi, type NotificationsMode, type SettingsPane } from "../main/gmail/api";
import { useAccounts, useAddAccount, useRemoveAccount, useUpdateAccount } from "../main/gmail/hooks";
import { useMailViews } from "../main/gmail/custom-views";
import { ViewEditorForm } from "../main/gmail/view-editor-form";
import { ACCOUNT_COLOR_PALETTE, getAccountColor, getAccountDisplayName } from "../main/gmail/account-style";
import type { GmailAccount, MailView } from "../main/gmail/types";

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

// System Settings-style sidebar entries: white glyph on a colored tile.
const PANES: { id: SettingsPane; label: string; color: string; icon: typeof UsersIcon }[] = [
  { id: "general", label: "General", color: "#8E8E93", icon: SettingsIcon },
  { id: "accounts", label: "Accounts", color: "#007AFF", icon: UsersIcon },
  { id: "views", label: "Views", color: "#AF52DE", icon: LayersIcon },
  { id: "oauth", label: "Google OAuth", color: "#34C759", icon: KeyRoundIcon },
];

function PaneIconTile({ color, Icon }: { color: string; Icon: typeof UsersIcon }) {
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-[5px]"
      style={{ backgroundColor: color }}
    >
      <Icon className="size-3.5 text-white" />
    </span>
  );
}

/** One entry in the settings navigation history. */
type Loc = { pane: SettingsPane; viewId: string | null; mailbox?: string | null };

function AccountRow({ account }: { account: GmailAccount }) {
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [name, setName] = useState(getAccountDisplayName(account));

  useEffect(() => {
    setName(getAccountDisplayName(account));
  }, [account.id, account.displayName, account.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === getAccountDisplayName(account)) return;
    console.log("[SettingsView:renameAccount]", { accountId: account.id, name: trimmed });
    void updateAccount.mutateAsync({ accountId: account.id, displayName: trimmed });
  };

  const color = getAccountColor(account);

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar size="small">
        {account.picture ? <AvatarImage src={account.picture} alt={name} /> : null}
        <AvatarFallback>{(name[0] ?? "?").toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-56"
        />
        <Text variant="mini" color="tertiary" truncate>
          {account.email}
        </Text>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {ACCOUNT_COLOR_PALETTE.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Set color ${swatch}`}
            className="size-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: swatch }}
            onClick={() => void updateAccount.mutateAsync({ accountId: account.id, color: swatch })}
          >
            {color === swatch ? <span className="size-1.5 rounded-full bg-white" /> : null}
          </button>
        ))}
      </div>
      {confirmingRemove ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="filled" size="small" onClick={() => setConfirmingRemove(false)}>
            Cancel
          </Button>
          <Button
            variant="filled"
            size="small"
            className="text-support-red"
            disabled={removeAccount.isPending}
            onClick={() => void removeAccount.mutateAsync(account.id)}
          >
            {removeAccount.isPending ? "Removing…" : "Remove"}
          </Button>
        </div>
      ) : (
        <Button
          variant="transparent"
          size="small"
          iconOnly
          aria-label={`Remove ${account.email}`}
          className="shrink-0 text-tertiary hover:text-support-red"
          onClick={() => setConfirmingRemove(true)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      )}
    </div>
  );
}

function viewIcon(view: MailView) {
  if (view.kind === "inbox") return <InboxIcon className="size-4 text-secondary" />;
  if (view.kind === "starred") return <StarIcon className="size-4 text-secondary" />;
  if (view.kind === "sent") return <SendIcon className="size-4 text-secondary" />;
  if (view.kind === "drafts") return <FileIcon className="size-4 text-secondary" />;
  if (view.kind === "important") return <BookmarkIcon className="size-4 text-secondary" />;
  if (view.kind === "junk") return <ArchiveXIcon className="size-4 text-secondary" />;
  if (view.kind === "trash") return <Trash2Icon className="size-4 text-secondary" />;
  return <LayersIcon className="size-4 text-secondary" />;
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
  if (view.rules === null) {
    return BUILTIN_SUMMARY[view.kind] ?? "Default";
  }
  const labels = view.rules.reduce((n, r) => n + r.allOf.length + r.noneOf.length, 0);
  const accounts = view.rules.length;
  return `${labels} filter${labels === 1 ? "" : "s"} across ${accounts} account${accounts === 1 ? "" : "s"}`;
}

const COMBINED_MAILBOX = "__combined__";

function ViewsPane({
  editingId,
  editingMailbox,
  onOpenView,
  onDone,
}: {
  editingId: string | null;
  /** Owning mailbox when creating (editingId "new"). */
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
        <Text variant="small" color="tertiary">
          Loading accounts…
        </Text>
      );
    }
    const editingView = editingId === "new" ? null : views.find((v) => v.id === editingId) ?? null;
    const mailbox = editingView
      ? (editingView.mailbox ?? COMBINED_MAILBOX)
      : (editingMailbox ?? COMBINED_MAILBOX);
    // Account-owned views edit against that account's labels only.
    const scopedAccounts =
      mailbox === COMBINED_MAILBOX ? accounts : accounts.filter((a) => a.id === mailbox);
    return (
      <ViewEditorForm
        key={editingId}
        view={editingView}
        accounts={scopedAccounts}
        onSave={(input) => saveView({ ...input, mailbox })}
        onDelete={deleteView}
        onReset={resetView}
        onDone={onDone}
      />
    );
  }

  // One section per mailbox: Combined first (it's a mailbox too), then accounts.
  const sections: { id: string; title: string; subtitle: string; views: MailView[] }[] = [
    ...(accounts.length > 1
      ? [
          {
            id: COMBINED_MAILBOX,
            title: "Combined",
            subtitle: "All mailboxes",
            views: views.filter((v) => (v.mailbox ?? COMBINED_MAILBOX) === COMBINED_MAILBOX),
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
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <Text variant="small-strong">{section.title}</Text>
            <Text variant="mini" color="tertiary">
              {section.subtitle}
            </Text>
          </div>
          {section.views.length > 0 ? (
            <div className="rounded-control bg-control-subtle p-1">
              <List.Root items={section.views} getItemKey={(v: MailView) => v.id}>
                {section.views.map((view) => (
                  <List.Item
                    key={view.id}
                    item={view}
                    onClick={() => onOpenView(view.id, section.id)}
                  >
                    <List.ItemIcon>{viewIcon(view)}</List.ItemIcon>
                    <List.ItemContent>
                      <List.ItemTitle>{view.name}</List.ItemTitle>
                      <List.ItemDescription>{viewSummary(view)}</List.ItemDescription>
                    </List.ItemContent>
                    <List.ItemAccessory>
                      <ChevronRightIcon className="size-4 text-tertiary" />
                    </List.ItemAccessory>
                  </List.Item>
                ))}
              </List.Root>
            </div>
          ) : (
            <Text variant="mini" color="tertiary">
              No views yet.
            </Text>
          )}
          <Button
            variant="filled"
            size="small"
            className="self-start"
            onClick={() => onOpenView("new", section.id)}
          >
            <PlusIcon className="size-4" />
            New view
          </Button>
        </div>
      ))}
    </div>
  );
}

export function SettingsView() {
  // System Settings-style navigation: a history stack driving the back/forward
  // buttons; sidebar clicks and drill-ins push entries.
  const [nav, setNav] = useState<{ stack: Loc[]; index: number }>({
    stack: [{ pane: "general", viewId: null }],
    index: 0,
  });
  const loc = nav.stack[nav.index];

  const navigate = (next: Loc) => {
    setNav((n) => {
      const current = n.stack[n.index];
      if (current.pane === next.pane && current.viewId === next.viewId) return n;
      const stack = [...n.stack.slice(0, n.index + 1), next];
      return { stack, index: stack.length - 1 };
    });
  };
  const goBack = () => setNav((n) => ({ ...n, index: Math.max(0, n.index - 1) }));
  const goForward = () => setNav((n) => ({ ...n, index: Math.min(n.stack.length - 1, n.index + 1) }));

  const { views } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const addAccount = useAddAccount();

  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  // Google OAuth state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);

  const [syncInterval, setSyncInterval] = useState<number | null>(null);
  const [notificationsMode, setNotificationsMode] = useState<NotificationsMode | null>(null);

  // Navigate to the pane (and view) other windows deep-link to, on mount and
  // whenever the backend signals a new target while this window is open.
  useEffect(() => {
    const pull = async () => {
      try {
        const target = await gmailApi.getSettingsTarget();
        if (!target) return;
        setNav((n) => {
          const next: Loc = {
            pane: target.pane,
            viewId: target.pane === "views" ? (target.viewId ?? null) : null,
            mailbox: target.pane === "views" ? (target.mailbox ?? null) : null,
          };
          const current = n.stack[n.index];
          if (current.pane === next.pane && current.viewId === next.viewId) return n;
          const stack = [...n.stack.slice(0, n.index + 1), next];
          return { stack, index: stack.length - 1 };
        });
      } catch (error) {
        console.log("[SettingsView:getSettingsTarget] error", { error: String(error) });
      }
    };
    void pull();
    const unsubscribe = window.glazeAPI.glaze.ipc.onNotification("settings:navigate", () => {
      void pull();
    });
    return unsubscribe;
  }, []);

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper]")) {
        return;
      }

      event.preventDefault();
      window.glazeAPI.glaze.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const refreshThemeInfo = async () => {
    try {
      const info = await window.glazeAPI.nativeTheme.getInfo();
      setThemeInfo(info);
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };

  const loadCredentials = async () => {
    console.log("[SettingsView:loadCredentials]");
    try {
      const result = await gmailApi.getCredentials();
      setHasCredentials(result.hasCredentials);
      setClientId(result.clientId ?? "");
      // Leave secret blank — show hint if credentials are already saved
    } catch (error) {
      toast.error(`Failed to load credentials: ${error}`);
    }
  };

  const loadSyncSettings = async () => {
    console.log("[SettingsView:loadSyncSettings]");
    try {
      const settings = await gmailApi.getSyncSettings();
      setSyncInterval(settings.syncIntervalSeconds);
      setNotificationsMode(settings.notificationsMode);
    } catch (error) {
      toast.error(`Failed to load sync settings: ${error}`);
    }
  };

  useEffect(() => {
    void refreshThemeInfo();
    void loadCredentials();
    void loadSyncSettings();
  }, []);

  const handleSyncIntervalChange = async (value: string) => {
    const seconds = Number(value);
    setSyncInterval(seconds);
    console.log("[SettingsView:setSyncInterval]", { seconds });
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
    console.log("[SettingsView:setNotificationsMode]", { mode });
    try {
      await gmailApi.setSyncSettings({ notificationsMode: mode });
    } catch (error) {
      toast.error(`Failed to save notifications setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleThemeChange = async (value: string) => {
    const source = value as "system" | "light" | "dark";
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(source);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error("Client ID and Client Secret are required");
      return;
    }
    console.log("[SettingsView:saveCredentials]");
    setIsSavingCredentials(true);
    try {
      const result = await gmailApi.setCredentials({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setHasCredentials(result.hasCredentials);
      setClientSecret(""); // Clear secret after save
      toast.success("Google OAuth credentials saved");
    } catch (error) {
      toast.error(`Failed to save credentials: ${error}`);
    } finally {
      setIsSavingCredentials(false);
    }
  };

  const firstAccount = accounts[0] ?? null;
  const accountHeaderName = firstAccount ? getAccountDisplayName(firstAccount) : "No accounts";
  const accountHeaderDetail =
    accounts.length > 1 ? `${accounts.length} accounts` : (firstAccount?.email ?? "Connect one to start");

  const paneTitle =
    loc.pane === "views" && loc.viewId
      ? loc.viewId === "new"
        ? "New View"
        : (views.find((v) => v.id === loc.viewId)?.name ?? "Views")
      : (PANES.find((p) => p.id === loc.pane)?.label ?? "Settings");

  return (
    <SplitView
      sidebar={
        <Sidebar>
          {/* Account header, System Settings-style */}
          <div className="px-2 pt-2 pb-1">
            <button
              type="button"
              onClick={() => navigate({ pane: "accounts", viewId: null })}
              className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-control-subtle cursor-pointer text-left"
            >
              <Avatar size="small">
                {firstAccount?.picture ? (
                  <AvatarImage src={firstAccount.picture} alt={accountHeaderName} />
                ) : null}
                <AvatarFallback>{(accountHeaderName[0] ?? "?").toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <Text variant="small-strong" truncate>
                  {accountHeaderName}
                </Text>
                <Text variant="mini" color="tertiary" truncate>
                  {accountHeaderDetail}
                </Text>
              </div>
            </button>
          </div>
          <SidebarList>
            {PANES.map((p) => (
              <SidebarListItem
                key={p.id}
                selected={loc.pane === p.id}
                className="hover:bg-control-subtle"
                onClick={() => navigate({ pane: p.id, viewId: null })}
              >
                <PaneIconTile color={p.color} Icon={p.icon} />
                <SidebarListItemContent>
                  <SidebarListItemTitle>{p.label}</SidebarListItemTitle>
                </SidebarListItemContent>
              </SidebarListItem>
            ))}
          </SidebarList>
        </Sidebar>
      }
      sidebarSize={{ default: 200, min: 180, max: 260 }}
    >
      <ScrollArea
        toolbar={
          <Toolbar>
            {/* ToolbarContent stacks vertically — a plain row keeps the title
                beside the navigation buttons, like System Settings. */}
            <div className="flex items-center gap-3 min-w-0">
              <NavigationButtonGroup
                canGoBack={nav.index > 0}
                canGoForward={nav.index < nav.stack.length - 1}
                onGoBack={goBack}
                onGoForward={goForward}
              />
              <ToolbarTitle>{paneTitle}</ToolbarTitle>
            </div>
          </Toolbar>
        }
      >
        <div className="px-6 pb-8 pt-2 max-w-2xl">
          {loc.pane === "general" ? (
            <div className="flex flex-col gap-5">
              <FieldSet title="Appearance">
                <Field label="Theme">
                  <RadioGroup
                    value={themeInfo?.themeSource ?? "system"}
                    onValueChange={handleThemeChange}
                    orientation="horizontal"
                  >
                    <Label>
                      <RadioGroupItem value="system" />
                      Auto
                    </Label>
                    <Label>
                      <RadioGroupItem value="light" />
                      Light
                    </Label>
                    <Label>
                      <RadioGroupItem value="dark" />
                      Dark
                    </Label>
                  </RadioGroup>
                </Field>
              </FieldSet>
              <FieldSet title="Mail">
                <Field label="Check for new mail" description="Sync runs in the background at this cadence.">
                  <Select
                    value={syncInterval != null ? String(syncInterval) : undefined}
                    onValueChange={(value) => void handleSyncIntervalChange(value)}
                  >
                    <SelectTrigger id="syncInterval" size="small" variant="transparent" className="w-40">
                      <SelectValue placeholder="Loading…" />
                    </SelectTrigger>
                    <SelectContent>
                      {SYNC_INTERVAL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Notifications" description="Notify about new mail found by background sync.">
                  <Select
                    value={notificationsMode ?? undefined}
                    onValueChange={(value) => void handleNotificationsModeChange(value)}
                  >
                    <SelectTrigger id="notificationsMode" size="small" variant="transparent" className="w-40">
                      <SelectValue placeholder="Loading…" />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTIFICATIONS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldSet>
            </div>
          ) : null}

          {loc.pane === "accounts" ? (
            <div className="flex flex-col gap-3">
              <FieldSet title="Accounts">
                {accounts.length > 0 ? (
                  <div className="flex flex-col divide-y divide-separator">
                    {accounts.map((account) => (
                      <AccountRow key={account.id} account={account} />
                    ))}
                  </div>
                ) : (
                  <Text color="secondary">No accounts yet — add one to start syncing mail.</Text>
                )}
              </FieldSet>
              <Button
                variant="filled"
                size="small"
                className="self-start"
                disabled={addAccount.isPending}
                onClick={() => void addAccount.mutateAsync().catch(() => {})}
              >
                <PlusIcon className="size-4" />
                {addAccount.isPending ? "Waiting for Google…" : "Add account…"}
              </Button>
            </div>
          ) : null}

          {loc.pane === "views" ? (
            <ViewsPane
              editingId={loc.viewId}
              editingMailbox={loc.mailbox ?? null}
              onOpenView={(viewId, mailbox) => navigate({ pane: "views", viewId, mailbox })}
              onDone={() => navigate({ pane: "views", viewId: null })}
            />
          ) : null}

          {loc.pane === "oauth" ? (
            <FieldSet
              title="Google OAuth"
              description="Your own Google Cloud OAuth client, used to connect Gmail accounts."
            >
              <Field label="Client ID">
                <Input
                  id="clientId"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="your-client-id.apps.googleusercontent.com"
                />
              </Field>
              <Field label="Client Secret">
                <Input
                  id="clientSecret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={hasCredentials ? "Saved — enter to update" : "Enter client secret"}
                />
              </Field>
              <Field>
                <Button
                  variant="accent"
                  size="small"
                  onClick={() => void handleSaveCredentials()}
                  disabled={isSavingCredentials || !clientId.trim() || !clientSecret.trim()}
                >
                  {isSavingCredentials ? "Saving..." : "Save"}
                </Button>
              </Field>
            </FieldSet>
          ) : null}
        </div>
      </ScrollArea>
    </SplitView>
  );
}
