import { useEffect, useRef, useState } from "react";
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
  Switch,
  Toolbar,
  ToolbarTitle,
  Field,
  FieldSet,
  Input,
  Button,
  Avatar,
  AvatarImage,
  AvatarFallback,
  ColorWell,
  Text,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import {
  gmailApi,
  type AssistantStatus,
  type ChatStatus,
  type MailApp,
  type NotificationsMode,
  type SettingsPane,
} from "../main/gmail/api";
import {
  useAccounts,
  useAddAccount,
  useRemoveAccount,
  useUpdateAccount,
} from "../main/gmail/hooks";
import { useMailViews } from "../main/gmail/custom-views";
import { RichTextArea, type RichTextRef } from "../main/gmail/rich-text";
import { ViewEditorForm } from "../main/gmail/view-editor-form";
import {
  getAccountColor,
  getAccountDisplayName,
} from "../main/gmail/account-style";
import type { GmailAccount, MailView } from "../main/gmail/types";
import {
  getAdvanceDirection,
  setAdvanceDirection as persistAdvanceDirection,
  type AdvanceDirection,
} from "../main/gmail/advance-direction";

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

// System Settings-style sidebar entries: white glyph on a colored tile.
const PANES: { id: SettingsPane; label: string; color: string; icon: typeof UsersIcon }[] = [
  { id: "general", label: "General", color: "#8E8E93", icon: SettingsIcon },
  { id: "accounts", label: "Accounts", color: "#007AFF", icon: UsersIcon },
  { id: "views", label: "Views", color: "#AF52DE", icon: LayersIcon },
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
  const [signatureOpen, setSignatureOpen] = useState(false);
  const signatureRef = useRef<RichTextRef>(null);

  useEffect(() => {
    setName(getAccountDisplayName(account));
  }, [account.id, account.displayName, account.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === getAccountDisplayName(account)) return;
    console.log("[SettingsView:renameAccount]", { accountId: account.id, name: trimmed });
    void updateAccount.mutateAsync({ accountId: account.id, displayName: trimmed });
  };

  const commitSignature = () => {
    const editor = signatureRef.current;
    if (!editor) return;
    const html = editor.getText().trim().length === 0 ? "" : editor.getHTML();
    if (html === (account.signature ?? "")) return;
    console.log("[SettingsView:updateSignature]", { accountId: account.id });
    void updateAccount.mutateAsync({ accountId: account.id, signature: html });
  };

  const color = getAccountColor(account);

  return (
    <div className="flex flex-col py-2 gap-3">
      <div className="flex items-center gap-2.5">
        <Avatar size="small" className="mt-0.5">
          {account.picture ? <AvatarImage src={account.picture} alt={name} /> : null}
          <AvatarFallback>{(name[0] ?? "?").toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col flex-1 min-w-0 gap-1">
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
        <ColorWell
          value={color}
          onChange={(swatch) => void updateAccount.mutateAsync({ accountId: account.id, color: swatch })}
          size="small"
          aria-label={`Set color for ${account.email}`}
          className="shrink-0 mt-0.5"
        />
        {confirmingRemove ? (
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
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
            className="shrink-0 text-tertiary hover:text-support-red mt-0.5"
            onClick={() => setConfirmingRemove(true)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </div>
      <div className="pl-[42px]">
        <button
          type="button"
          onClick={() => setSignatureOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[12px] text-tertiary hover:text-secondary"
        >
          <PenLineIcon className="size-3" />
          {account.signature ? "Edit signature" : "Add signature"}
          <ChevronRightIcon
            className={`size-3 transition-transform ${signatureOpen ? "rotate-90" : ""}`}
          />
        </button>
        {signatureOpen ? (
          <div className="mt-2 rounded-[6px] border border-(--te-outline) bg-(--te-panel)">
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
    const editingView =
      editingId === "new" ? null : (views.find((v) => v.id === editingId) ?? null);
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

  // One section per mailbox: Combined first (it's a mailbox too), then
  // accounts. Built-ins are fixed system mailboxes (not configurable) — only
  // custom views are listed here.
  type Group = { label: string; views: MailView[]; canAdd: boolean; emptyHint?: string };
  const sections: { id: string; title: string; subtitle: string; groups: Group[] }[] = [
    ...(accounts.length > 1
      ? [
          {
            id: COMBINED_MAILBOX,
            title: "Combined",
            subtitle: "All mailboxes",
            groups: [
              {
                label: "Views",
                views: views.filter(
                  (v) =>
                    v.kind === "custom" && (v.mailbox ?? COMBINED_MAILBOX) === COMBINED_MAILBOX,
                ),
                canAdd: true,
                emptyHint: "No views yet.",
              },
            ],
          },
        ]
      : []),
    ...accounts.map((a) => ({
      id: a.id,
      title: getAccountDisplayName(a),
      subtitle: a.email,
      groups: [
        {
          label: "Views",
          views: views.filter((v) => v.kind === "custom" && v.mailbox === a.id),
          canAdd: true,
          emptyHint: "No views yet.",
        },
      ],
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <Text variant="small-strong">{section.title}</Text>
            <Text variant="mini" color="tertiary">
              {section.subtitle}
            </Text>
          </div>
          {section.groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              {section.groups.length > 1 ? (
                <Text variant="mini" color="secondary">
                  {group.label}
                </Text>
              ) : null}
              {group.views.length > 0 ? (
                <div className="rounded-control bg-control-subtle p-1">
                  <List.Root items={group.views} getItemKey={(v: MailView) => v.id}>
                    {group.views.map((view) => (
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
              ) : group.emptyHint ? (
                <Text variant="mini" color="tertiary">
                  {group.emptyHint}
                </Text>
              ) : null}
              {group.canAdd ? (
                <Button
                  variant="filled"
                  size="small"
                  className="self-start"
                  onClick={() => onOpenView("new", section.id)}
                >
                  <PlusIcon className="size-4" />
                  New view
                </Button>
              ) : null}
            </div>
          ))}
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
  const goForward = () =>
    setNav((n) => ({ ...n, index: Math.min(n.stack.length - 1, n.index + 1) }));

  const { views } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const addAccount = useAddAccount();

  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  const [syncInterval, setSyncInterval] = useState<number | null>(null);
  const [notificationsMode, setNotificationsMode] = useState<NotificationsMode | null>(null);
  const [advanceDirection, setAdvanceDirectionState] = useState<AdvanceDirection>(() =>
    getAdvanceDirection(),
  );
  const handleAdvanceDirectionChange = (value: string) => {
    const direction = value as AdvanceDirection;
    console.log("[SettingsView:setAdvanceDirection]", { direction });
    setAdvanceDirectionState(direction);
    persistAdvanceDirection(direction);
  };
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [trayEnabled, setTrayEnabled] = useState(true);
  const [mailApps, setMailApps] = useState<MailApp[]>([]);
  const [defaultMailBundleId, setDefaultMailBundleId] = useState<string | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [assistantToken, setAssistantToken] = useState("");
  const [assistantBotId, setAssistantBotId] = useState("");
  const [assistantSaving, setAssistantSaving] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatSaving, setChatSaving] = useState(false);

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

  const loadSyncSettings = async () => {
    console.log("[SettingsView:loadSyncSettings]");
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
      console.log("[SettingsView:listMailApps] failed", { error: String(error) });
    }
  };

  const handleDefaultMailChange = async (bundleId: string) => {
    setDefaultMailBundleId(bundleId);
    console.log("[SettingsView:setDefaultMailApp]", { bundleId });
    try {
      await gmailApi.setDefaultMailApp(bundleId);
    } catch (error) {
      toast.error(`Failed to change default mail app: ${error}`);
    }
    // macOS may still put a consent dialog in the way — re-read the actual
    // state rather than trusting the optimistic selection.
    void loadMailApps();
  };

  const loadAssistantStatus = async () => {
    try {
      setAssistantStatus(await gmailApi.assistantGetStatus());
    } catch (error) {
      console.log("[SettingsView:assistantStatus] failed", { error: String(error) });
    }
  };

  const handleAssistantSave = async () => {
    if (!assistantToken.trim() || !assistantBotId.trim()) {
      toast.error("Slack user token and bot member ID are both required");
      return;
    }
    setAssistantSaving(true);
    console.log("[SettingsView:assistantConfigure]");
    try {
      const status = await gmailApi.assistantConfigure({
        token: assistantToken.trim(),
        botUserId: assistantBotId.trim(),
      });
      setAssistantStatus(status);
      setAssistantToken("");
      setAssistantBotId("");
      toast.success(`Connected to ${status.teamName || "Slack"}`);
    } catch (error) {
      toast.error(`Could not connect: ${error}`);
    } finally {
      setAssistantSaving(false);
    }
  };

  const loadChatStatus = async () => {
    try {
      setChatStatus(await gmailApi.chatStatus());
    } catch (error) {
      console.log("[SettingsView:chatStatus] failed", { error: String(error) });
    }
  };

  const handleChatSave = async () => {
    if (!chatBaseUrl.trim() || !chatApiKey.trim()) {
      toast.error("API base URL and key are both required");
      return;
    }
    setChatSaving(true);
    console.log("[SettingsView:chatConfigure]");
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

  useEffect(() => {
    void refreshThemeInfo();
    void loadSyncSettings();
    void loadMailApps();
    void loadAssistantStatus();
    void loadChatStatus();
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

  const handleLaunchAtLoginChange = async (checked: boolean) => {
    setLaunchAtLogin(checked);
    console.log("[SettingsView:setLaunchAtLogin]", { checked });
    try {
      await gmailApi.setSyncSettings({ launchAtLogin: checked });
    } catch (error) {
      toast.error(`Failed to save launch-at-login setting: ${error}`);
      void loadSyncSettings();
    }
  };

  const handleTrayEnabledChange = async (checked: boolean) => {
    setTrayEnabled(checked);
    console.log("[SettingsView:setTrayEnabled]", { checked });
    try {
      await gmailApi.setSyncSettings({ trayEnabled: checked });
    } catch (error) {
      toast.error(`Failed to save menu-bar icon setting: ${error}`);
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

  const firstAccount = accounts[0] ?? null;
  const accountHeaderName = firstAccount ? getAccountDisplayName(firstAccount) : "No accounts";
  const accountHeaderDetail =
    accounts.length > 1
      ? `${accounts.length} accounts`
      : (firstAccount?.email ?? "Connect one to start");

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
              <FieldSet title="Startup & Menu Bar">
                <Field
                  label="Launch at login"
                  description="Automatically open OtterMail when you log in to your Mac."
                >
                  <Switch
                    id="launchAtLogin"
                    checked={launchAtLogin}
                    onCheckedChange={(checked) => void handleLaunchAtLoginChange(checked)}
                  />
                </Field>
                <Field
                  label="Show menu-bar icon"
                  description="Show an OtterMail icon in the menu bar with a quick unread inbox view."
                >
                  <Switch
                    id="trayEnabled"
                    checked={trayEnabled}
                    onCheckedChange={(checked) => void handleTrayEnabledChange(checked)}
                  />
                </Field>
              </FieldSet>
              <FieldSet title="Mail">
                <Field
                  label="Check for new mail"
                  description="Sync runs in the background at this cadence."
                >
                  <Select
                    value={syncInterval != null ? String(syncInterval) : undefined}
                    onValueChange={(value) => void handleSyncIntervalChange(value)}
                  >
                    <SelectTrigger
                      id="syncInterval"
                      size="small"
                      variant="transparent"
                      className="w-40"
                    >
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
                <Field
                  label="Notifications"
                  description="Notify about new mail found by background sync."
                >
                  <Select
                    value={notificationsMode ?? undefined}
                    onValueChange={(value) => void handleNotificationsModeChange(value)}
                  >
                    <SelectTrigger
                      id="notificationsMode"
                      size="small"
                      variant="transparent"
                      className="w-40"
                    >
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
                <Field
                  label="After archive, delete, or move"
                  description="Which message to select next in the list."
                >
                  <Select value={advanceDirection} onValueChange={handleAdvanceDirectionChange}>
                    <SelectTrigger
                      id="advanceDirection"
                      size="small"
                      variant="transparent"
                      className="w-56"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADVANCE_DIRECTION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldSet>
              <FieldSet title="Assistant">
                <Field
                  label="Hermes over Slack"
                  description={
                    assistantStatus?.configured
                      ? `Connected to ${assistantStatus.teamName || "your workspace"} — Ask-Hermes actions post into your bot DM as you.`
                      : "Paste a Slack user token (chat:write, im:write) and the bot's member ID to enable Ask-Hermes handoffs."
                  }
                >
                  <div className="flex flex-col items-end gap-1.5">
                    <Input
                      type="password"
                      value={assistantToken}
                      onChange={(e) => setAssistantToken(e.target.value)}
                      placeholder={
                        assistantStatus?.configured ? "Replace token (xoxp-…)" : "xoxp-…"
                      }
                      aria-label="Slack user token"
                      className="w-56"
                    />
                    <Input
                      value={assistantBotId}
                      onChange={(e) => setAssistantBotId(e.target.value)}
                      placeholder={
                        assistantStatus?.botUserId
                          ? `Bot member ID (${assistantStatus.botUserId})`
                          : "Bot member ID (U…)"
                      }
                      aria-label="Bot member ID"
                      className="w-56"
                    />
                    <Button
                      size="small"
                      disabled={assistantSaving}
                      onClick={() => void handleAssistantSave()}
                    >
                      {assistantSaving
                        ? "Connecting…"
                        : assistantStatus?.configured
                          ? "Reconnect"
                          : "Connect"}
                    </Button>
                  </div>
                </Field>
                <Field
                  label="Hermes chat"
                  description={
                    chatStatus?.configured
                      ? `Chat panel connected to ${chatStatus.baseUrl} (${chatStatus.model}).`
                      : "The chat panel talks to Hermes' OpenAI-compatible API server over Tailscale. Paste the /v1 base URL and the API_SERVER_KEY."
                  }
                >
                  <div className="flex flex-col items-end gap-1.5">
                    <Input
                      value={chatBaseUrl}
                      onChange={(e) => setChatBaseUrl(e.target.value)}
                      placeholder={chatStatus?.baseUrl ?? "https://<host>:8642/v1"}
                      aria-label="Hermes API base URL"
                      className="w-56"
                    />
                    <Input
                      type="password"
                      value={chatApiKey}
                      onChange={(e) => setChatApiKey(e.target.value)}
                      placeholder={chatStatus?.configured ? "Replace API key" : "API key"}
                      aria-label="Hermes API key"
                      className="w-56"
                    />
                    <Button
                      size="small"
                      disabled={chatSaving}
                      onClick={() => void handleChatSave()}
                    >
                      {chatSaving
                        ? "Connecting…"
                        : chatStatus?.configured
                          ? "Reconnect"
                          : "Connect"}
                    </Button>
                  </div>
                </Field>
              </FieldSet>
              <FieldSet title="System">
                <Field
                  label="Default email app"
                  description="Which app opens mailto: links across macOS."
                >
                  <Select
                    value={defaultMailBundleId ?? undefined}
                    onValueChange={(value) => void handleDefaultMailChange(value)}
                  >
                    <SelectTrigger
                      id="defaultMailApp"
                      size="small"
                      variant="transparent"
                      className="w-40"
                    >
                      <SelectValue placeholder="Loading…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mailApps.map((app) => (
                        <SelectItem key={app.bundleId} value={app.bundleId}>
                          {app.name}
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
        </div>
      </ScrollArea>
    </SplitView>
  );
}
