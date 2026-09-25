/**
 * Auto-update from GitHub Releases through electron-updater. The feed comes
 * from app-update.yml, which electron-builder writes from the publish config
 * (see scripts/build-desktop-artifact.ts). Builds on a nightly version follow
 * the nightly channel; everything else follows stable ("latest").
 *
 * Nothing downloads on its own: the renderer shows "update available", the
 * user downloads, then restarts to install.
 */

import { app, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";

import { UPDATE_STATE_CHANNEL, type UpdateState } from "@otter-mail/contracts";

import { broadcast } from "./ipc.js";
import { logger } from "./logger.js";

const { autoUpdater } = electronUpdater;

const STARTUP_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 4 * 60 * 60_000;

const channel: UpdateState["channel"] = /-nightly\.\d{8}\.\d+$/.test(app.getVersion())
  ? "nightly"
  : "latest";

let state: UpdateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  channel,
  availableVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
};

function setState(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch };
  broadcast(UPDATE_STATE_CHANNEL, state);
  return state;
}

function disabledReason(): string | null {
  if (process.env.OTTER_MAIL_DISABLE_AUTO_UPDATE === "1") return "Updates are turned off.";
  if (!app.isPackaged) return "Updates only run in packaged builds.";
  if (!fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    return "This build has no update feed.";
  }
  return null;
}

async function check(): Promise<UpdateState> {
  if (state.status === "disabled" || state.status === "downloading") return state;
  if (state.status === "downloaded") return state;
  setState({ status: "checking", message: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The "error" event has already reported it.
    if (state.status === "checking") {
      logger.warn("updates", "Update check failed", err);
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
  return state;
}

async function download(): Promise<UpdateState> {
  if (state.status !== "available") return state;
  setState({ status: "downloading", downloadPercent: 0, message: null });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    logger.warn("updates", "Update download failed", err);
    setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
  }
  return state;
}

export function initUpdates(): void {
  ipcMain.handle("updates:getState", () => state);
  ipcMain.handle("updates:check", () => check());
  ipcMain.handle("updates:download", () => download());
  ipcMain.handle("updates:install", () => {
    if (state.status !== "downloaded") return;
    logger.info("updates", "Restarting to install", { version: state.availableVersion });
    autoUpdater.quitAndInstall(true, true);
  });

  const reason = disabledReason();
  if (reason) {
    setState({ status: "disabled", message: reason });
    return;
  }

  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  // Installing on quit would also fire when ⌘Q only hides the window.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === "nightly";
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (info) => {
    setState({
      status: "available",
      availableVersion: info.version,
      checkedAt: Date.now(),
    });
  });
  autoUpdater.on("update-not-available", () => {
    setState({ status: "up-to-date", availableVersion: null, checkedAt: Date.now() });
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    // Only every 5%: the renderer re-renders on each push.
    if (state.downloadPercent == null || percent - state.downloadPercent >= 5) {
      setState({ status: "downloading", downloadPercent: percent });
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    setState({ status: "downloaded", availableVersion: info.version, downloadPercent: 100 });
  });
  autoUpdater.on("error", (err) => {
    // A repository without releases yet (or without any on this channel).
    if (/No published versions/i.test(err.message)) {
      setState({ status: "up-to-date", availableVersion: null, checkedAt: Date.now() });
      return;
    }
    logger.warn("updates", "Updater error", err);
    setState({ status: "error", message: err.message });
  });

  setTimeout(() => void check(), STARTUP_DELAY_MS);
  setInterval(() => void check(), POLL_INTERVAL_MS);
}
