import { BrowserWindow, app, logger } from "@glaze/core/backend";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";

/**
 * Standalone single-message window (Cmd+click a row). One window per message
 * id — a second Cmd+click on the same message just refocuses it. The target
 * rides in the URL query so each window is self-contained. Same glass look as
 * the main window.
 */
export async function openMessageWindow(accountId: string, messageId: string): Promise<void> {
  const windowKey = `message:${messageId}`;
  const existing = BrowserWindow.getAllWindows().find((w) => w.windowKey === windowKey);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    app.focus({ steal: true });
    return;
  }

  logger.info("message-window", "Opening", { accountId, messageId });
  const win = new BrowserWindow({
    windowKey,
    width: 900,
    height: 720,
    minWidth: 600,
    minHeight: 440,
    title: "OtterMail",
    show: false,
    backgroundColor: "#00000000",
    vibrancy: "sidebar",
    webPreferences: {
      preload: getPreloadPath(),
      transparent: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  const base = await getWindowUrl("message-window.html");
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}account=${encodeURIComponent(accountId)}&message=${encodeURIComponent(messageId)}`;
  await win.loadURL(url);
}
