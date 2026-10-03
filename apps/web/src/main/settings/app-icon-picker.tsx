import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { APP_ICONS, DEFAULT_APP_ICON } from "@otter-mail/shared/app-icons";
import { appIconUrl, setAppIcon, useAppIcon } from "../theme/app-icon";
import { toast } from "../gmail/toast";
import { cn } from "../gmail/ui";
import { SettingsSection, SettingResetButton } from "./settings-ui";
import { searchableSetting } from "./settings-search";

export function AppIconPicker() {
  const chosen = useAppIcon();
  const [pending, setPending] = useState(false);

  async function pick(id: string) {
    setPending(true);
    try {
      await setAppIcon(id);
    } catch (error) {
      toast.error("Couldn't change the app icon", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection
      {...searchableSetting("app-icon")}
      description="Choose an icon for this device, independently of your theme."
      variant="plain"
      headerAction={
        chosen !== DEFAULT_APP_ICON && !pending ? (
          <SettingResetButton label="app icon" onClick={() => void pick(DEFAULT_APP_ICON)} />
        ) : null
      }
    >
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-label="App icon">
        {APP_ICONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-label={`${label} app icon`}
            aria-pressed={chosen === id}
            disabled={pending}
            onClick={() => void pick(id)}
            className={cn(
              "relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait",
              chosen === id
                ? "border-primary bg-accent-surface text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent-surface",
            )}
          >
            <img src={appIconUrl(id)} alt="" className="size-14 rounded-[13px] shadow-sm" />
            <span>{label}</span>
            {chosen === id ? (
              <CheckIcon className="absolute right-1.5 top-1.5 size-3.5 text-primary" />
            ) : null}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
