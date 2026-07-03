import { useEffect, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  KeyRoundIcon,
  LayersIcon,
  PlusIcon,
  SendIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react";
import {
  Label,
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
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
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

const PANES: { id: SettingsPane; label: string; icon: typeof UsersIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "accounts", label: "Accounts", icon: UsersIcon },
  { id: "views", label: "Views", icon: LayersIcon },
  { id: "oauth", label: "Google OAuth", icon: KeyRoundIcon },
];

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
  if (view.kind === "inbox") return <InboxIcon className="size-4 shrink-0 text-secondary" />;
  if (view.kind === "sent") return <SendIcon className="size-4 shrink-0 text-secondary" />;
  return <LayersIcon className="size-4 shrink-0 text-secondary" />;
}

function viewSummary(view: MailView): string {
  if (view.rules === null) {
    return view.kind === "inbox" ? "Default — every account's Inbox" : "Default — every account's Sent";
  }
  const labels = view.rules.reduce((n, r) => n + r.allOf.length + r.noneOf.length, 0);
  const accounts = view.rules.length;
  return `${labels} filter${labels === 1 ? "" : "s"} across ${accounts} account${accounts === 1 ? "" : "s"}`;
}

function ViewsPane({ target, onConsumeTarget }: { target: string | null; onConsumeTarget: () => void }) {
  const { views, saveView, deleteView, resetView } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  /** View id being edited, "new" for a fresh view, or null for the list. */
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setEditing(target);
    onConsumeTarget();
  }, [target, onConsumeTarget]);

  if (editing) {
    if (!accountsQuery.data) {
      return (
        <Text variant="small" color="tertiary">
          Loading accounts…
        </Text>
      );
    }
    const editingView = editing === "new" ? null : views.find((v) => v.id === editing) ?? null;
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="flex items-center gap-1 self-start text-secondary hover:text-primary cursor-pointer"
        >
          <ChevronLeftIcon className="size-4" />
          <Text variant="small">All views</Text>
        </button>
        <ViewEditorForm
          key={editing}
          view={editingView}
          accounts={accounts}
          onSave={saveView}
          onDelete={deleteView}
          onReset={resetView}
          onDone={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded-control border border-separator divide-y divide-separator">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setEditing(view.id)}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-control-subtle cursor-pointer text-left first:rounded-t-control last:rounded-b-control"
          >
            {viewIcon(view)}
            <div className="flex flex-col flex-1 min-w-0">
              <Text variant="small-strong" truncate>
                {view.name}
              </Text>
              <Text variant="mini" color="tertiary" truncate>
                {viewSummary(view)}
              </Text>
            </div>
            <ChevronRightIcon className="size-4 shrink-0 text-tertiary" />
          </button>
        ))}
      </div>
      <Button variant="filled" size="small" className="self-start" onClick={() => setEditing("new")}>
        <PlusIcon className="size-4" />
        New view
      </Button>
    </div>
  );
}

export function SettingsView() {
  const [pane, setPane] = useState<SettingsPane>("general");
  const [viewTarget, setViewTarget] = useState<string | null>(null);

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
        setPane(target.pane);
        if (target.pane === "views" && target.viewId) setViewTarget(target.viewId);
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

  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  const activePane = PANES.find((p) => p.id === pane) ?? PANES[0];

  return (
    <SplitView
      sidebar={
        <Sidebar>
          <SidebarList>
            {PANES.map((p) => (
              <SidebarListItem
                key={p.id}
                selected={pane === p.id}
                className="hover:bg-control-subtle"
                onClick={() => setPane(p.id)}
              >
                <p.icon className="size-4 shrink-0" />
                <SidebarListItemContent>
                  <SidebarListItemTitle>{p.label}</SidebarListItemTitle>
                </SidebarListItemContent>
              </SidebarListItem>
            ))}
          </SidebarList>
        </Sidebar>
      }
      sidebarSize={{ default: 190, min: 170, max: 240 }}
    >
      <ScrollArea
        toolbar={
          <Toolbar>
            <ToolbarRow>
              <ToolbarContent>
                <ToolbarTitle>{activePane.label}</ToolbarTitle>
              </ToolbarContent>
            </ToolbarRow>
          </Toolbar>
        }
      >
        <div className="px-6 pb-8 pt-2 max-w-2xl">
          {pane === "general" ? (
            <FieldSet>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="theme">Theme</FieldLabel>
                  </FieldContent>
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
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="syncInterval">Check for new mail</FieldLabel>
                  </FieldContent>
                  <Select
                    value={syncInterval != null ? String(syncInterval) : undefined}
                    onValueChange={(value) => void handleSyncIntervalChange(value)}
                  >
                    <SelectTrigger id="syncInterval" className="w-44">
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
              </FieldGroup>
            </FieldSet>
          ) : null}

          {pane === "accounts" ? (
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

          {pane === "views" ? (
            <ViewsPane target={viewTarget} onConsumeTarget={() => setViewTarget(null)} />
          ) : null}

          {pane === "oauth" ? (
            <FieldSet title="Google OAuth">
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="clientId">Client ID</FieldLabel>
                  </FieldContent>
                  <Input
                    id="clientId"
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="your-client-id.apps.googleusercontent.com"
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="clientSecret">Client Secret</FieldLabel>
                  </FieldContent>
                  <div className="flex flex-col gap-1 flex-1">
                    <Input
                      id="clientSecret"
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={hasCredentials ? "Saved — enter to update" : "Enter client secret"}
                    />
                  </div>
                </Field>
                <Field orientation="horizontal">
                  <FieldContent />
                  <Button
                    variant="accent"
                    size="small"
                    onClick={() => void handleSaveCredentials()}
                    disabled={isSavingCredentials || !clientId.trim() || !clientSecret.trim()}
                  >
                    {isSavingCredentials ? "Saving..." : "Save"}
                  </Button>
                </Field>
              </FieldGroup>
            </FieldSet>
          ) : null}
        </div>
      </ScrollArea>
    </SplitView>
  );
}
