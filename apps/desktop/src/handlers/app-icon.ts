import { app, ipcMain, nativeImage } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_APP_ICON, isAppIcon } from "@otter-mail/shared/app-icons";
import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";

/** A device-local choice; restored before the main window opens. */
export function registerAppIconHandlers(): void {
  const file = join(app.getPath("userData"), "app-icon.json");
  const resources = app.isPackaged
    ? join(process.resourcesPath, "app-icons")
    : join(app.getAppPath(), "resources/app-icons");
  let chosen = DEFAULT_APP_ICON;

  function icon(id: string) {
    const image = nativeImage.createFromPath(join(resources, `${id}.png`));
    if (image.isEmpty()) throw new Error("Couldn't load this app icon.");
    return image;
  }

  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (isAppIcon(stored)) {
      app.dock?.setIcon(icon(stored));
      chosen = stored;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("app-icon", "Couldn't restore the app icon", error);
    }
  }

  ipcMain.handle("appIcon:get", () => chosen);
  ipcMain.handle("appIcon:set", (_event, id: unknown) => {
    if (!isAppIcon(id)) throw new Error("Unknown app icon.");
    const image = icon(id);
    writeFileSync(file, JSON.stringify(id));
    app.dock?.setIcon(image);
    chosen = id;
    broadcast("appIcon:changed", id);
    return id;
  });
}
