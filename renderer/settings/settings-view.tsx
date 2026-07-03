import { useState, useEffect } from "react";
import { SlidersHorizontalIcon, UsersIcon, KeyRoundIcon } from "lucide-react";
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  TabsRoot,
  Tabs,
  TabsTrigger,
  TabsContent,
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
import { gmailApi } from "../main/gmail/api";
import { useAccounts, useUpdateAccount } from "../main/gmail/hooks";
import { ACCOUNT_COLOR_PALETTE, getAccountColor, getAccountDisplayName } from "../main/gmail/account-style";
import type { GmailAccount } from "../main/gmail/types";

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
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <Text variant="mini" color="tertiary" truncate>
          {account.email}
        </Text>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 pt-1.5">
        {ACCOUNT_COLOR_PALETTE.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Set account color to ${swatch}`}
            onClick={() => {
              console.log("[SettingsView:setAccountColor]", { accountId: account.id, color: swatch });
              void updateAccount.mutateAsync({ accountId: account.id, color: swatch });
            }}
            className="size-5 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: swatch }}
          >
            {color === swatch ? <span className="size-1.5 rounded-full bg-white" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsView() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("general");
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  // Google OAuth state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);

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
    } finally {
      setIsLoading(false);
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

  useEffect(() => {
    void refreshThemeInfo();
    void loadCredentials();
  }, []);

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

  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      <ScrollArea
        toolbar={
          <Toolbar>
            <ToolbarContent>
              <ToolbarTitle>Settings</ToolbarTitle>
            </ToolbarContent>
            <ToolbarRow className="justify-center pb-1">
              <Tabs variant="glass" size="large">
                <TabsTrigger value="general">
                  <span className="flex flex-col items-center gap-1 px-1">
                    <SlidersHorizontalIcon className="size-4" />
                    <Text variant="mini">General</Text>
                  </span>
                </TabsTrigger>
                <TabsTrigger value="accounts">
                  <span className="flex flex-col items-center gap-1 px-1">
                    <UsersIcon className="size-4" />
                    <Text variant="mini">Accounts</Text>
                  </span>
                </TabsTrigger>
                <TabsTrigger value="oauth">
                  <span className="flex flex-col items-center gap-1 px-1">
                    <KeyRoundIcon className="size-4" />
                    <Text variant="mini">Google OAuth</Text>
                  </span>
                </TabsTrigger>
              </Tabs>
            </ToolbarRow>
          </Toolbar>
        }
      >
        <div className="px-6 pb-8">
          <TabsContent value="general" className="pt-4">
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
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          <TabsContent value="accounts" className="pt-4">
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
          </TabsContent>

          <TabsContent value="oauth" className="pt-4">
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
          </TabsContent>
        </div>
      </ScrollArea>
    </TabsRoot>
  );
}
