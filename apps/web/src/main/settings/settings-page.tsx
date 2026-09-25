import { useEffect, useState } from "react";
import { Switch } from "~/components/ui/switch";
import { toast } from "../gmail/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../gmail/select";
import { gmailApi, type MailApp, type NotificationsMode, type SettingsPane } from "../gmail/api";
import {
  getAdvanceDirection,
  setAdvanceDirection as persistAdvanceDirection,
  type AdvanceDirection,
} from "../gmail/advance-direction";
import { cn } from "../gmail/ui";
import { AppearancePane } from "./appearance-pane";
import { KeybindingsPane } from "./keybindings-pane";
import { AccountsPane } from "./accounts-pane";
import { ViewsPane } from "./views-pane";
import { ProvidersPane } from "./providers-pane";
import { TranslationSection } from "./translation-section";
import { UpdatesSection } from "../updates";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-ui";

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
    // "" keeps the Select controlled (showing the placeholder) while the value loads.
    <Select value={value ?? ""} onValueChange={onValueChange}>
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

      <TranslationSection />

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

      <UpdatesSection />
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
  if (route.pane === "assistant") return <ProvidersPane />;
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
