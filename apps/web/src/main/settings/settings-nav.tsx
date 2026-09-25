import type { ComponentType } from "react";
import {
  ArrowLeftIcon,
  BotIcon,
  KeyboardIcon,
  LayersIcon,
  PaletteIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import type { SettingsPane } from "../gmail/api";
import { cn } from "../gmail/ui";

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsPane;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "accounts", label: "Accounts", icon: UsersIcon },
  { id: "views", label: "Views", icon: LayersIcon },
  { id: "assistant", label: "Assistant", icon: BotIcon },
];

export function settingsSectionLabel(pane: SettingsPane): string {
  return SETTINGS_SECTIONS.find((s) => s.id === pane)?.label ?? "Settings";
}

const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-(--sidebar-control-gap) rounded-[var(--control-radius)] px-(--sidebar-row-content-inset) text-left text-sm font-medium outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active [&>svg]:size-4 [&>svg]:shrink-0";

/** Sidebar contents while the settings page is open: back row + sections. */
export function SettingsNav({
  pane,
  onSelect,
  onBack,
}: {
  pane: SettingsPane;
  onSelect: (pane: SettingsPane) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-(--sidebar-content-inset) pb-4 pt-1">
        <div className="px-(--sidebar-row-content-inset) pb-1 pt-1 text-xs font-medium text-sidebar-muted-foreground/70">
          Settings
        </div>
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = section.id === pane;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                ROW,
                active
                  ? "bg-sidebar-row-selected text-sidebar-foreground [&>svg]:text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:text-(--sidebar-icon-color) hover:[&>svg]:text-sidebar-foreground",
              )}
            >
              <Icon />
              <span className="truncate">{section.label}</span>
            </button>
          );
        })}
      </div>
      {/* Bottom row, like Otter Code's settings sidebar. */}
      <div className="flex shrink-0 items-center gap-1 px-(--sidebar-content-inset) py-1">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            ROW,
            "w-auto min-w-0 flex-1 text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:text-(--sidebar-icon-color) hover:[&>svg]:text-sidebar-foreground",
          )}
        >
          <ArrowLeftIcon />
          <span className="truncate">Back</span>
        </button>
      </div>
    </>
  );
}
