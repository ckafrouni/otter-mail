import type { Theme } from "@glaze/core/components";

/**
 * Slack seed themes for the main window. root-view.tsx injects the one
 * matching the system appearance (and re-injects on change) so every SDK
 * surface (dialogs, menus, toasts, inputs) derives from the same palette as
 * the custom chrome. The Settings window never injects them and stays native.
 */
export const SLACK_DARK_THEME: Theme = {
  id: "slack-dark",
  name: "Slack Dark",
  appearance: "dark",
  background: "#1b1d21",
  backgroundSecondary: "#131317",
  foreground: "#ffffff",
  accent: "#1d9bd1",
  selection: "#1164a3",
  loader: "#ffffff",
  red: "#e8567c",
  orange: "#ff9217",
  yellow: "#ecb22e",
  green: "#2eb67d",
  blue: "#36c5f0",
  purple: "#a485ff",
  magenta: "#e01e5a",
};

export const SLACK_LIGHT_THEME: Theme = {
  id: "slack-light",
  name: "Slack Light",
  appearance: "light",
  background: "#ffffff",
  backgroundSecondary: "#f4f1f4",
  foreground: "#1d1c1d",
  accent: "#1264a3",
  selection: "#1264a3",
  loader: "#1d1c1d",
  red: "#e01e5a",
  orange: "#cc6d2d",
  yellow: "#d9a400",
  green: "#007a5a",
  blue: "#1264a3",
  purple: "#7c5cbf",
  magenta: "#c21e6e",
};
