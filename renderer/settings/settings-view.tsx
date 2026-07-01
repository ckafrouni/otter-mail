import { useState, useEffect } from "react";
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
  Input,
  Button,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import { gmailApi } from "../main/gmail/api";

export function SettingsView() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const [_isLoading, setIsLoading] = useState(true);

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
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Settings</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
      }
    >
      <div className="px-4 flex flex-col gap-8 mb-8">
        {/* Google OAuth Section */}
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

        {/* Theme Section */}
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
      </div>
    </ScrollArea>
  );
}
