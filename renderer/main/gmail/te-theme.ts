import type { Theme } from "@glaze/core/components";

/**
 * Teenage-engineering-inspired seed themes for the main window. root-view.tsx
 * injects the one matching the system appearance (and re-injects on change)
 * so every SDK surface (dialogs, menus, toasts, inputs) derives from the same
 * palette as the custom chrome. The Settings window never injects them and
 * stays native.
 */
export const TE_DARK_THEME: Theme = {
  id: "te-dark",
  name: "TE Dark",
  appearance: "dark",
  background: "#1b1b19",
  backgroundSecondary: "#0f0f0e",
  foreground: "#f2f0ea",
  accent: "#ff5b26",
  selection: "#ff5b26",
  loader: "#f2f0ea",
  red: "#e0442e",
  orange: "#ff5b26",
  yellow: "#f4b400",
  green: "#3aa15f",
  blue: "#4a86e8",
  purple: "#8e63ce",
  magenta: "#e07798",
};

export const TE_LIGHT_THEME: Theme = {
  id: "te-light",
  name: "TE Light",
  appearance: "light",
  background: "#f2f1ed",
  backgroundSecondary: "#d7d4ce",
  foreground: "#191813",
  accent: "#ff4e00",
  selection: "#ff4e00",
  loader: "#191813",
  red: "#cc3a21",
  orange: "#e34500",
  yellow: "#d9a400",
  green: "#149e60",
  blue: "#3c78d8",
  purple: "#7c5cbf",
  magenta: "#c21e6e",
};
