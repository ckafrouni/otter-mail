/**
 * @otter-mail/core: the mail backend. The desktop app runs it in Electron's
 * main process, the web app in a Web Worker; each hands `startCore` its
 * Platform (platform.ts) and serves `registeredHandlers()` to the renderer.
 */

import { registerCalendarHandlers } from "./handlers/calendar.js";
import { registerGmailHandlers } from "./handlers/gmail.js";
import { registerOtterAccountHandlers } from "./handlers/otter-account.js";
import { registerSearchHandlers } from "./handlers/search.js";
import { registerTranslationHandlers } from "./handlers/translation.js";
import { broadcast, handle } from "./ipc.js";
import { setPlatform, type Platform } from "./platform.js";
import { pruneAttachmentCache } from "./services/attachment-cache.js";
import { readKeybindings, writeKeybindings } from "./services/keybindings-store.js";
import { configureAutoSync, syncAllAccounts } from "./services/mail-sync.js";
import { loadOtterAccount } from "./services/otter-account.js";
import { getSettings } from "./services/settings-store.js";

/** Starts the backend: restores sign-ins, registers every handler, and syncs. */
export async function startCore(platform: Platform): Promise<void> {
  setPlatform(platform);
  await platform.google.load();
  await loadOtterAccount();

  registerGmailHandlers();
  registerSearchHandlers();
  registerCalendarHandlers();
  registerOtterAccountHandlers();
  registerTranslationHandlers();
  handle("keybindings:read", async () => readKeybindings());
  handle("keybindings:write", async (params: unknown) => {
    const result = await writeKeybindings((params as { rules?: unknown } | undefined)?.rules);
    broadcast("keybindings:updated");
    return result;
  });

  // Warm the local cache for every connected account.
  void syncAllAccounts({ force: true });
  configureAutoSync((await getSettings()).syncIntervalSeconds);
  void pruneAttachmentCache();
}

export { broadcast, handle, registeredHandlers, type Handler } from "./ipc.js";
export { fromBase64, toBase64 } from "./bytes.js";
export { SIGNED_OUT_MESSAGE, SignInCancelledError } from "./google.js";
export { logger } from "./logger.js";
export type * from "./platform.js";
export * as accountStore from "./services/account-store.js";
export * as mailStore from "./services/mail-store.js";
export { runAsTask } from "./handlers/ipc-budget.js";
export { getAttachmentBytes } from "./services/gmail-api.js";
export { KEYBINDINGS_FILE } from "./services/keybindings-store.js";
export { syncAllAccounts } from "./services/mail-sync.js";
export {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type AppSettings,
} from "./services/settings-store.js";
export type * from "./types.js";
