import { useEffect, useState } from "react";
import {
  ChevronRightIcon,
  InboxIcon,
  KeyRoundIcon,
  LayersIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
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
  ToolbarContent,
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
import { gmailApi, type SettingsPane } from "../main/gmail/api";
import { useAccounts, useUpdateAccount } from "../main/gmail/hooks";
import { useMailViews } from "../main/gmail/custom-views";
import { ViewEditorForm } from "../main/gmail/view-editor-form";
import { ACCOUNT_COLOR_PALETTE, getAccountColor, getAccountDisplayName } from "../main/gmail/account-style";
import type { GmailAccount, MailView } from "../main/gmail/types";

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
type Loc = { pane: SettingsPane; viewId: string | null };

function AccountRow({ account }: { account: GmailAccount }) {
  const updateAccount = useUpdateAccount();
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
    <div className="flex items-start gap-3 py-2">
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
        />
        <Text variant="mini" color="tertiary" truncate>
          {account.email}
        </Text>
        <div className="flex items-center gap-1.5 pt-0.5">
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
      </div>
    </div>
  );
}

function viewIcon(view: MailView) {
  if (view.kind === "inbox") return <InboxIcon className="size-4 text-secondary" />;
  if (view.kind === "sent") return <SendIcon className="size-4 text-secondary" />;
  return <LayersIcon className="size-4 text-secondary" />;
}

function viewSummary(view: MailView): string {
  if (view.rules === null) {
    return view.kind === "inbox" ? "Default — every account's Inbox" : "Default — every account's Sent";
  }
  const labels = view.rules.reduce((n, r) => n + r.allOf.length + r.noneOf.length, 0);
  const accounts = view.rules.length;
  return `${labels} filter${labels === 1 ? "" : "s"} across ${accounts} account${accounts === 1 ? "" : "s"}`;
}

function ViewsPane({
  editingId,
  onOpenView,
  onDone,
}: {
  editingId: string | null;
  onOpenView: (viewId: string) => void;
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
    return (
      <ViewEditorForm
        key={editingId}
        view={editingView}
        accounts={accounts}
        onSave={saveView}
        onDelete={deleteView}
        onReset={resetView}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-control bg-control-subtle p-1">
        <List.Root items={views} getItemKey={(v: MailView) => v.id}>
          {views.map((view) => (
            <List.Item key={view.id} item={view} onClick={() => onOpenView(view.id)}>
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
      <Button variant="filled" size="small" className="self-start" onClick={() => onOpenView("new")}>
        <PlusIcon className="size-4" />
        New view
      </Button>
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

  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  // Google OAuth state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);

  const [syncInterval, setSyncInterval] = useState<number | null>(null);

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
            <ToolbarContent>
              <NavigationButtonGroup
                canGoBack={nav.index > 0}
                canGoForward={nav.index < nav.stack.length - 1}
                onGoBack={goBack}
                onGoForward={goForward}
              />
              <ToolbarTitle>{paneTitle}</ToolbarTitle>
            </ToolbarContent>
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
              </FieldSet>
            </div>
          ) : null}

          {loc.pane === "accounts" ? (
            <FieldSet title="Accounts">
              {accounts.length > 0 ? (
                <div className="flex flex-col divide-y divide-separator">
                  {accounts.map((account) => (
                    <AccountRow key={account.id} account={account} />
                  ))}
                </div>
              ) : (
                <Text color="secondary">Connect an account from the sidebar to manage it here.</Text>
              )}
            </FieldSet>
          ) : null}

          {loc.pane === "views" ? (
            <ViewsPane
              editingId={loc.viewId}
              onOpenView={(viewId) => navigate({ pane: "views", viewId })}
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
