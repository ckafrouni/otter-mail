import type { Theme } from "@glaze/core/components";

/**
 * Slack-dark seed theme for the main window. Injected once at startup
 * (root-view.tsx) so every SDK surface (dialogs, menus, toasts, inputs)
 * derives from the same palette as the custom chrome. The Settings window
 * never injects it and stays native.
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
