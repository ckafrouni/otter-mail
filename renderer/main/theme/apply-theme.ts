import { injectActiveTheme, type Theme } from "@glaze/core/components";
import { useEffect, useState } from "react";
import { APP_DARK_THEME, APP_LIGHT_THEME } from "../gmail/app-theme";
import {
  BUILT_IN_THEMES,
  OTTER_DARK_THEME_COLORS,
  OTTER_LIGHT_THEME_COLORS,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "./theme-palettes";

/**
 * App color themes, the Otter Code model: each appearance (light, dark)
 * independently wears one theme. The choice lives in localStorage (shared by
 * every window of the app), and a `storage` event re-themes the other windows
 * live. "otter" is the stock palette defined in styles.css.
 */

export const DEFAULT_THEME_ID = "otter";
/** What a fresh install wears (both appearances) until the user picks a theme. */
export const INITIAL_THEME_ID = "ocean";

/** The stock palette as a definition, for previews (it is never written as overrides). */
export const OTTER_THEME: ThemeDefinition = {
  id: DEFAULT_THEME_ID,
  label: "Otter Code",
  appearance: "light",
  colors: OTTER_LIGHT_THEME_COLORS,
  variants: { light: OTTER_LIGHT_THEME_COLORS, dark: OTTER_DARK_THEME_COLORS },
};

export const APP_THEMES: ReadonlyArray<ThemeDefinition> = [OTTER_THEME, ...BUILT_IN_THEMES];

const STORAGE_KEY: Record<ThemeAppearance, string> = {
  light: "otter:theme:light",
  dark: "otter:theme:dark",
};
const CHANGE_EVENT = "otter:theme-change";

export type ThemeChoice = Record<ThemeAppearance, string>;

export function getThemeChoice(): ThemeChoice {
  const read = (mode: ThemeAppearance) => {
    const id = localStorage.getItem(STORAGE_KEY[mode]);
    return id && APP_THEMES.some((t) => t.id === id) ? id : INITIAL_THEME_ID;
  };
  return { light: read("light"), dark: read("dark") };
}

/** Assigns a theme to one appearance and re-themes this and every other window. */
export function setThemeForAppearance(mode: ThemeAppearance, themeId: string): void {
  console.log("[AppTheme:set]", { mode, themeId });
  localStorage.setItem(STORAGE_KEY[mode], themeId);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function themeColors(themeId: string, mode: ThemeAppearance): ThemeColors {
  const theme = APP_THEMES.find((t) => t.id === themeId) ?? OTTER_THEME;
  return (
    getThemeColorsForAppearance(theme, mode) ??
    (mode === "dark" ? OTTER_DARK_THEME_COLORS : OTTER_LIGHT_THEME_COLORS)
  );
}

/**
 * The built-in palettes carry opaque, fairly strong structure colors (borders,
 * row highlights, raised surfaces) — several steps above their canvas, where
 * the stock palette keeps those a hair off the background. Blend each back
 * toward the surface it sits on so themes keep their hue but match the stock
 * palette's quiet contrast. Text and accent roles are left as designed.
 */
function soften(color: string, over: string, keep: number): string {
  return `color-mix(in oklab, ${color} ${keep}%, ${over})`;
}

/** Theme role → the app's CSS variables (mirrors Otter Code's index.css mapping). */
function cssVariables(c: ThemeColors): string {
  const vars: Record<string, string> = {
    "--canvas": c.canvas,
    "--app-chrome-background": c.chrome,
    "--foreground": c.text,
    "--card": soften(c.surface, c.canvas, 60),
    "--card-foreground": c.text,
    "--popover": c.surfaceOverlay,
    "--popover-foreground": c.text,
    "--surface-raised": soften(c.surfaceRaised, c.canvas, 45),
    "--chat-composer-surface": soften(c.surfaceRaised, c.canvas, 45),
    "--primary": c.messageAction,
    "--primary-foreground": c.messageActionForeground,
    "--secondary": soften(c.secondary, c.canvas, 55),
    "--secondary-foreground": c.secondaryForeground,
    "--muted": soften(c.muted, c.canvas, 55),
    "--muted-foreground": c.mutedForeground,
    "--placeholder": c.placeholder,
    "--secondary-label": c.secondaryLabel,
    "--icon-muted": c.iconMuted,
    "--accent-surface": soften(c.accentSurface, c.canvas, 45),
    "--accent-surface-foreground": c.accentSurfaceForeground,
    "--message-surface": soften(c.messageSurface, c.canvas, 70),
    "--message-foreground": c.messageForeground,
    "--error": c.error,
    "--error-foreground": c.errorForeground,
    "--error-surface": c.errorSurface,
    "--destructive": c.error,
    "--destructive-foreground": c.errorForeground,
    "--warning": c.warning,
    "--warning-foreground": c.warningForeground,
    "--warning-surface": c.warningSurface,
    "--border": soften(c.border, c.canvas, 35),
    "--input": soften(c.input, c.canvas, 50),
    "--ring": c.focus,
    "--sidebar-surface": c.sidebar,
    "--sidebar-foreground": c.sidebarForeground,
    "--sidebar-muted-foreground": c.sidebarMutedForeground,
    "--sidebar-control-surface": soften(c.sidebarControlSurface, c.sidebar, 50),
    "--sidebar-row-hover": soften(c.sidebarRowHover, c.sidebar, 45),
    "--sidebar-row-active": soften(c.sidebarRowActive, c.sidebar, 50),
    "--sidebar-row-selected": soften(c.sidebarRowSelected, c.sidebar, 50),
    "--sidebar-line": soften(c.sidebarBorder, c.sidebar, 30),
    "--code-background": soften(c.codeBackground, c.canvas, 60),
    "--code-foreground": c.codeForeground,
  };
  return Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
}

/** Seed theme for Glaze's own surfaces (dialogs, toasts) matching the palette. */
function glazeTheme(themeId: string, mode: ThemeAppearance, c: ThemeColors): Theme {
  const base = mode === "dark" ? APP_DARK_THEME : APP_LIGHT_THEME;
  if (themeId === DEFAULT_THEME_ID) return base;
  return {
    ...base,
    id: `otter-${themeId}-${mode}`,
    name: `${themeId} ${mode}`,
    background: c.canvas,
    backgroundSecondary: c.sidebar,
    foreground: c.text,
    accent: c.messageAction,
    selection: c.focus,
    loader: c.text,
  };
}

const STYLE_ID = "otter-app-theme";

/** Applies the theme for the current system/app appearance to this window. */
export function applyAppTheme(): void {
  const mode: ThemeAppearance = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const themeId = getThemeChoice()[mode];
  const colors = themeColors(themeId, mode);
  injectActiveTheme(glazeTheme(themeId, mode, colors));

  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID);
  if (themeId === DEFAULT_THEME_ID) {
    root.removeAttribute("data-theme-id");
    style?.remove();
    return;
  }
  root.setAttribute("data-theme-id", themeId);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
  }
  // Appended last in <head>, and the attribute selectors out-rank both the
  // stock `.dark` tokens and the sidebar's own [data-app-sidebar] scope.
  style.textContent = `html[data-theme-id],\nhtml[data-theme-id] [data-app-sidebar] {\n${cssVariables(colors)}\n}`;
  document.head.appendChild(style);
}

/** Applies now and keeps the window in sync (appearance switches, other windows' picks). */
export function startAppTheme(): () => void {
  applyAppTheme();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY.light || e.key === STORAGE_KEY.dark) applyAppTheme();
  };
  mq.addEventListener("change", applyAppTheme);
  window.addEventListener(CHANGE_EVENT, applyAppTheme);
  window.addEventListener("storage", onStorage);
  return () => {
    mq.removeEventListener("change", applyAppTheme);
    window.removeEventListener(CHANGE_EVENT, applyAppTheme);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current theme choice, re-read whenever it changes (for the settings UI). */
export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState(getThemeChoice);
  useEffect(() => {
    const update = () => setChoice(getThemeChoice());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return choice;
}
