// Main process entry point - Node.js backend for Glaze app
//
// The glaze CLI runtime automatically handles all framework wiring (IPC server,
// native bridge, lifecycle, signal handlers) before this file runs.
// This entry point uses only APIs.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  logger,
  initDevToolsButtonState,
} from "@glaze/core/backend";

import { registerHandlers } from "./handlers/index.js";
import { parseMailtoUrl, setPendingMailto } from "./services/mailto-target.js";
import { syncAllAccounts } from "./services/mail-sync.js";
import { pruneAttachmentCache } from "./services/attachment-cache.js";
import { createTray, destroyTray } from "./services/tray.js";
import { getSettings } from "./services/settings-store.js";
import { getPreloadPath, getWindowUrl } from "./windows/window-paths.js";
import { setSettingsTarget } from "./windows/settings-window.js";
import { focusMainWindow } from "./services/tray.js";

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── IPC Handlers ──────────────────────────────────────────────────────
// ipcMain is already wired to the IPC server by the runtime bootstrap.
registerHandlers();

// ── mailto: handling (default mail app) ───────────────────────────────
// Clicking a mailto link anywhere in macOS lands here once OtterMail is the
// default mail app. Stash the parsed target (the renderer pulls it via
// app:takePendingMailto on mount — covers cold starts) and nudge any live
// main window via broadcast.
app.on("open-url", (url: string) => {
  const target = parseMailtoUrl(url);
  logger.info("main", "open-url", { mailto: target != null });
  if (!target) return;
  setPendingMailto(target);
  const win = BrowserWindow.getAllWindows().find((w) => w.windowKey === "main");
  win?.show();
  app.focus({ steal: true });
  ipcMain.broadcast("compose:mailto");
});

// ── Dev-only parity harness ───────────────────────────────────────────
// The parity autotest lives in main/dev/, which is excluded from scaffolded
// apps. The build (build-backend) defines GLAZE_DEV_HARNESS="1" only when that
// directory is present, so esbuild dead-code-eliminates this block — and never
// resolves the missing module — for user apps. A no-op unless a scenario env var
// is set even in the template.
type DevHarness = {
  applyParityScenarioStartup(): void;
  runParityAutotestIfRequested(): Promise<void>;
};
let devHarness: DevHarness | null = null;
if (process.env.GLAZE_DEV_HARNESS === "1") {
  // @ts-ignore dev-only harness; present only in the template, excluded from scaffolded apps
  devHarness = (await import("./dev/parity-autotest.js")) as DevHarness;
  devHarness.applyParityScenarioStartup();
}

// ── State ─────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

// ── Window creation ───────────────────────────────────────────────────
export async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug("main", "Main window already exists, skipping creation");
    return;
  }

  // Read display name from package.json
  // In production: __dirname = build/main, package.json is at ../../package.json
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");

  const minWindowWidth = 760;
  const minWindowHeight = 520;
  const windowWidth = 1180;
  const windowHeight = 780;
  let windowTitle = "Glaze App";

  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf-8"));
      windowTitle = packageJson.productName || packageJson.appConfig?.displayName || windowTitle;
    }
  } catch {
    // Use defaults
  }

  // Create main window
  const browserWindowStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] Creating BrowserWindow", {
    timestamp: new Date().toISOString(),
  });

  mainWindow = new BrowserWindow({
    windowKey: "main", // Stable key for frame persistence
    width: windowWidth,
    height: windowHeight,
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    title: windowTitle,
    show: false, // Don't show until WebView is ready (prevents flickering)
    // Native glass: the renderer keeps its base layers transparent and paints
    // the TE frame as a translucent wash over this material. webPreferences
    // transparency is required too — without it the WKWebView composites an
    // opaque page background over the vibrancy material.
    backgroundColor: "#00000000",
    vibrancy: "sidebar",
    webPreferences: {
      preload: getPreloadPath(),
      transparent: true,
    },
  });

  const browserWindowEndTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] BrowserWindow constructor completed", {
    timestamp: new Date().toISOString(),
    duration_ms: browserWindowEndTime - browserWindowStartTime,
  });

  // Wait for ready-to-show event before showing window (prevents flickering)
  mainWindow.once("ready-to-show", () => {
    const showStartTime = Date.now();
    logger.info("main", "⏱️ [COLD_START] ready-to-show event received, showing window", {
      timestamp: new Date().toISOString(),
    });

    mainWindow?.show();

    const showEndTime = Date.now();
    logger.info("main", "⏱️ [COLD_START] Window shown", {
      timestamp: new Date().toISOString(),
      duration_ms: showEndTime - showStartTime,
    });
  });

  // Determine URL to load (dev server preferred, fallback to build files)
  const url = await getWindowUrl("main-window.html");
  logger.info("main", "Resolved main window URL", { url });

  // Load URL - window will be shown automatically when ready-to-show fires
  const loadURLStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] Loading URL in window", {
    timestamp: new Date().toISOString(),
    url,
  });

  await mainWindow.loadURL(url);

  const loadURLEndTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] URL loaded in window (waiting for ready-to-show)", {
    timestamp: new Date().toISOString(),
    duration_ms: loadURLEndTime - loadURLStartTime,
  });
}

// ── Application menu ──────────────────────────────────────────────────
async function setupApplicationMenu() {
  await initDevToolsButtonState();
  const menu = Menu.buildFromTemplate([
    {
      label: "App",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          icon: "gearshape",
          accelerator: "Command+,",
          click: async () => {
            setSettingsTarget({ pane: "general", viewId: null, mailbox: null });
            await focusMainWindow();
            ipcMain.broadcast("settings:open");
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      // WKWebView consumes ⌘[/⌘] before the page sees a keydown, so history
      // navigation has to be intercepted here at the menu level.
      label: "Go",
      submenu: [
        {
          label: "Back",
          icon: "chevron.left",
          accelerator: "Command+[",
          click: () => {
            ipcMain.broadcast("nav:back");
          },
        },
        {
          label: "Forward",
          icon: "chevron.right",
          accelerator: "Command+]",
          click: () => {
            ipcMain.broadcast("nav:forward");
          },
        },
      ],
    },
    {
      label: "Mailbox",
      submenu: [
        {
          label: "Synchronize All Mailboxes",
          icon: "arrow.triangle.2.circlepath",
          accelerator: "Shift+Command+N",
          click: () => {
            logger.info("main", "Menu: Synchronize All Mailboxes");
            void syncAllAccounts({ force: true });
          },
        },
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
  logger.info("main", "Application menu configured with Settings");
}

// ── Lifecycle events ──────────────────────────────────────────────────
app.on("window-all-closed", () => {
  // On macOS, apps typically don't quit when all windows are closed
  // Uncomment to quit on all windows closed:
  // app.quit();
});

app.on("activate", (hasVisibleWindows) => {
  logger.info("main", "App activate event received", {
    hasVisibleWindows,
    mainWindowExists: !!mainWindow,
    mainWindowDestroyed: mainWindow?.isDestroyed() ?? true,
  });

  // On macOS, re-create window when dock icon clicked if no windows
  if (!hasVisibleWindows) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.info("main", "Creating main window due to activate event");
      createMainWindow();
    } else {
      logger.info("main", "Showing existing main window");
      mainWindow.show();
    }
  } else {
    logger.info("main", "Has visible windows, no action needed");
  }
});

app.on("before-quit", () => {
  logger.info("main", "App before-quit, cleaning up...");
});

app.on("will-quit", () => {
  destroyTray();
});

// ── App ready ─────────────────────────────────────────────────────────
const startTime = Date.now();
logger.info("main", "⏱️ [COLD_START] Waiting for app ready...", {
  timestamp: new Date().toISOString(),
});

app.whenReady().then(async () => {
  const windowCreateStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] App ready, creating main window", {
    timestamp: new Date().toISOString(),
    wait_duration_ms: windowCreateStartTime - startTime,
  });

  await devHarness?.runParityAutotestIfRequested();

  await setupApplicationMenu();

  // The Slack handoff was removed; drop its stored token and routing config.
  for (const file of ["assistant-slack.enc", "assistant.json"]) {
    fs.promises.rm(path.join(app.getPath("userData"), file), { force: true }).catch(() => {});
  }

  const startupSettings = await getSettings();
  app.setLoginItemSettings({ openAtLogin: startupSettings.launchAtLogin });
  if (startupSettings.trayEnabled) {
    void createTray();
  }

  void pruneAttachmentCache();

  createMainWindow()
    .then(() => {
      const windowCreateEndTime = Date.now();
      logger.info("main", "⏱️ [COLD_START] Main window created successfully", {
        timestamp: new Date().toISOString(),
        duration_ms: windowCreateEndTime - windowCreateStartTime,
      });
    })
    .catch((error) => {
      logger.error("main", "Failed to create main window", error);
    });
});
