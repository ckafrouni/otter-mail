import { APP_THEMES } from "./theme-palettes.ts";

/** Bundled icons, independent of the appearance's theme. Codex is the original silver mark. */
export const APP_ICONS = APP_THEMES.map(({ id, label }) => ({ id, label }));
export const DEFAULT_APP_ICON = "codex";

export function isAppIcon(value: unknown): value is string {
  return typeof value === "string" && APP_ICONS.some((icon) => icon.id === value);
}
