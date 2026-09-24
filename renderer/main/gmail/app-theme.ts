import type { Theme } from "@glaze/core/components";

/**
 * Otter Code seed themes for the app windows. root-view.tsx injects the one
 * matching the system appearance (and re-injects on change) so every SDK
 * surface (dialogs, menus, toasts, inputs) derives from the same palette as
 * the custom chrome in styles.css: zinc-25 / zinc-800 in light, neutral-950 /
 * neutral-100 in dark, one blue primary. The Settings window never injects
 * them and stays native.
 */
export const APP_DARK_THEME: Theme = {
  id: "otter-dark",
  name: "Otter Dark",
  appearance: "dark",
  background: "#0a0a0a",
  backgroundSecondary: "#000000",
  foreground: "#f5f5f5",
  accent: "#346bf1",
  selection: "#346bf1",
  loader: "#f5f5f5",
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#fbbf24",
  green: "#34d399",
  blue: "#60a5fa",
  purple: "#a78bfa",
  magenta: "#f472b6",
};

export const APP_LIGHT_THEME: Theme = {
  id: "otter-light",
  name: "Otter Light",
  appearance: "light",
  background: "#fcfcfc",
  backgroundSecondary: "#fafafa",
  foreground: "#27272a",
  accent: "#1b4ed8",
  selection: "#1b4ed8",
  loader: "#27272a",
  red: "#b91c1c",
  orange: "#c2410c",
  yellow: "#b45309",
  green: "#047857",
  blue: "#1d4ed8",
  purple: "#6d28d9",
  magenta: "#be185d",
};
