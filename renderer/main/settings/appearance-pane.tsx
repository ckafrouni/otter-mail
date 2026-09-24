import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import { MoonIcon, SunIcon } from "lucide-react";
import { cn, HintTooltip } from "../gmail/ui";
import {
  APP_THEMES,
  setThemeForAppearance,
  themeColors,
  useThemeChoice,
} from "../theme/apply-theme";
import type { ThemeAppearance, ThemeColors, ThemeDefinition } from "../theme/theme-palettes";
import { SettingsPageContainer } from "./settings-ui";

type ColorScheme = "system" | "light" | "dark";

// ---------------------------------------------------------------------------
// Color scheme cards: a miniature window painted with the chosen theme.
// ---------------------------------------------------------------------------

/** A tiny mail window (sidebar, list lines, bubble, composer) in one palette. */
function MiniWindow({ colors }: { colors: ThemeColors }) {
  const line = (width: string, extra?: CSSProperties) => (
    <span
      className="block h-1.5 rounded-full"
      style={{ width, backgroundColor: colors.textMuted, opacity: 0.35, ...extra }}
    />
  );
  return (
    <span className="flex size-full" style={{ backgroundColor: colors.canvas }}>
      <span
        className="flex w-[26%] flex-col gap-1.5 px-2 pt-2.5"
        style={{
          backgroundColor: colors.sidebar,
          borderRight: `1px solid ${colors.sidebarBorder}`,
        }}
      >
        <span
          className="block h-2 rounded-full"
          style={{
            backgroundColor: colors.sidebarRowSelected,
            border: `1px solid ${colors.border}`,
          }}
        />
        {line("80%")}
        {line("65%")}
        {line("72%")}
      </span>
      <span className="relative flex flex-1 flex-col gap-1.5 px-3 pt-3">
        <span className="flex justify-end">
          <span
            className="block h-3 w-[38%] rounded-full"
            style={{ backgroundColor: colors.messageSurface }}
          />
        </span>
        {line("62%")}
        {line("48%")}
        <span
          className="absolute inset-x-3 bottom-2.5 flex h-4 items-center justify-end rounded-full px-1"
          style={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}` }}
        >
          <span
            className="block size-2.5 rounded-full"
            style={{ backgroundColor: colors.messageAction }}
          />
        </span>
      </span>
    </span>
  );
}

function SchemeCard({
  scheme,
  selected,
  light,
  dark,
  onSelect,
}: {
  scheme: ColorScheme;
  selected: boolean;
  light: ThemeColors;
  dark: ThemeColors;
  onSelect: () => void;
}) {
  const label = scheme === "system" ? "System" : scheme === "light" ? "Light" : "Dark";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border bg-card/40 p-2 pb-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        selected
          ? "border-primary text-foreground ring-1 ring-primary"
          : "border-border/60 text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border border-border/60">
        {scheme === "system" ? (
          <>
            <span className="absolute inset-0">
              <MiniWindow colors={light} />
            </span>
            <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
              <MiniWindow colors={dark} />
            </span>
          </>
        ) : (
          <MiniWindow colors={scheme === "light" ? light : dark} />
        )}
      </span>
      <span className={selected ? "font-medium" : undefined}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Theme orbs (ported from Otter Code's ThemePreviewCircles).
// ---------------------------------------------------------------------------

const ORB_SPEC = {
  light: {
    baseTarget: "#ffffff",
    accent: { center: "72% 22%", middleOffset: 28, middleOpacity: 72, endOffset: 58 },
    action: { center: "18% 82%", startOpacity: 45, endOffset: 55 },
  },
  dark: {
    baseTarget: "#09090b",
    accent: { center: "28% 78%", middleOffset: 28, middleOpacity: 62, endOffset: 58 },
    action: { center: "82% 18%", startOpacity: 45, endOffset: 55 },
  },
} as const;

function orbStyle(colors: ThemeColors, mode: ThemeAppearance): CSSProperties {
  const spec = ORB_SPEC[mode];
  return {
    backgroundColor: `color-mix(in oklab, ${colors.canvas} 80%, ${spec.baseTarget})`,
    backgroundImage: [
      `radial-gradient(circle at ${spec.accent.center} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity}%, transparent) ${spec.accent.middleOffset}%, transparent ${spec.accent.endOffset}%)`,
      `radial-gradient(circle at ${spec.action.center} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity}%, transparent) 0%, transparent ${spec.action.endOffset}%)`,
    ].join(", "),
    filter: "blur(3px)",
    transform: "scale(1.1)",
  };
}

function ThemeOrb({
  theme,
  mode,
  picked,
  onPick,
}: {
  theme: ThemeDefinition;
  mode: ThemeAppearance;
  picked: boolean;
  onPick: () => void;
}) {
  const colors = themeColors(theme.id, mode);
  return (
    <HintTooltip label={mode === "light" ? "Use for light mode" : "Use for dark mode"}>
      <button
        type="button"
        aria-label={`Use ${theme.label} for ${mode} mode`}
        aria-pressed={picked}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        className={cn(
          "relative flex size-[68px] shrink-0 cursor-pointer items-center justify-center rounded-full p-1 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-focus-ring",
          !picked && "hover:scale-105",
        )}
      >
        <span
          aria-hidden
          className="relative block size-14 overflow-hidden rounded-full border-2 border-canvas"
          style={{
            boxShadow:
              mode === "dark"
                ? "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)"
                : "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)",
          }}
        >
          <span className="absolute inset-0 rounded-full" style={orbStyle(colors, mode)} />
        </span>
        {picked ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: "inset 0 0 0 2px var(--ring)" }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-canvas text-foreground shadow-sm"
            >
              {mode === "light" ? <SunIcon className="size-3" /> : <MoonIcon className="size-3" />}
            </span>
          </>
        ) : null}
      </button>
    </HintTooltip>
  );
}

function ThemeCard({
  theme,
  pickedModes,
  onPick,
}: {
  theme: ThemeDefinition;
  pickedModes: ThemeAppearance[];
  onPick: (modes: ThemeAppearance[]) => void;
}) {
  const active = pickedModes.length > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Use ${theme.label} for light and dark mode`}
      onClick={() => onPick(["light", "dark"])}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(["light", "dark"]);
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card/40 pb-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        active ? "border-input" : "border-border/60 hover:border-input",
      )}
    >
      <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
        {(["light", "dark"] as const).map((mode) => (
          <ThemeOrb
            key={mode}
            theme={theme}
            mode={mode}
            picked={pickedModes.includes(mode)}
            onPick={() => onPick([mode])}
          />
        ))}
      </div>
      <span className="px-4 text-sm font-medium text-foreground">{theme.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: string }) {
  return <h2 className="px-3 text-sm font-normal text-foreground/70 sm:px-4">{children}</h2>;
}

export function AppearancePane() {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const choice = useThemeChoice();

  const refreshThemeInfo = async () => {
    try {
      setThemeInfo(await window.glazeAPI.nativeTheme.getInfo());
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };
  useEffect(() => {
    void refreshThemeInfo();
  }, []);

  const scheme: ColorScheme = themeInfo?.themeSource ?? "system";
  const setScheme = async (next: ColorScheme) => {
    console.log("[Settings:setColorScheme]", { scheme: next });
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(next);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set color scheme: ${error}`);
    }
  };

  const light = themeColors(choice.light, "light");
  const dark = themeColors(choice.dark, "dark");

  return (
    <SettingsPageContainer>
      <section className="space-y-2.5">
        <SectionTitle>Color scheme</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          {(["system", "light", "dark"] as const).map((s) => (
            <SchemeCard
              key={s}
              scheme={s}
              selected={scheme === s}
              light={light}
              dark={dark}
              onSelect={() => void setScheme(s)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2.5">
        <SectionTitle>Themes</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {APP_THEMES.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              pickedModes={(["light", "dark"] as const).filter((m) => choice[m] === theme.id)}
              onPick={(modes) => {
                for (const mode of modes) setThemeForAppearance(mode, theme.id);
              }}
            />
          ))}
        </div>
        <p className="px-3 text-xs text-muted-foreground/80 sm:px-4">
          Click a theme to use it everywhere, or a single orb to use it for light or dark mode only.
        </p>
      </section>
    </SettingsPageContainer>
  );
}
