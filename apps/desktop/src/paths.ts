/**
 * Where Otter Mail keeps its data, as in T3 Code: a data home (~/.otter-mail,
 * or OTTER_MAIL_HOME) holding one state dir per kind of run, so development
 * never shares a database with the installed app.
 *
 * - installed app:                  ~/.otter-mail/userdata
 * - unpackaged (`pnpm dev`/`start`): ~/.otter-mail/dev
 * - explicit OTTER_MAIL_HOME:       $OTTER_MAIL_HOME/userdata
 *
 * `pnpm dev` in a linked git worktree sets OTTER_MAIL_HOME to the worktree's
 * gitignored `.otter-mail` (apps/desktop/scripts/dev-home.mjs), so each branch
 * gets its own data too.
 *
 * Inside the state dir: the app's own files (mail-cache.db, accounts, tokens,
 * settings…), Chromium's profile in `chromium/`, and logs in `logs/`.
 */

import { app } from "electron";
import * as os from "node:os";
import * as path from "node:path";

/** Must run before `ready` and before anything reads app paths. */
export function configureAppPaths(): string {
  // A separate name keeps dev off the installed app's Keychain key (safeStorage).
  app.setName(app.isPackaged ? "Otter Mail" : "Otter Mail (Dev)");
  const configuredHome = process.env.OTTER_MAIL_HOME?.trim();
  const home = configuredHome
    ? path.resolve(configuredHome)
    : path.join(os.homedir(), ".otter-mail");
  const useDevDir = !app.isPackaged && !configuredHome;
  const stateDir = path.join(home, useDevDir ? "dev" : "userdata");
  app.setPath("userData", stateDir);
  app.setPath("sessionData", path.join(stateDir, "chromium"));
  app.setAppLogsPath(path.join(stateDir, "logs"));
  return stateDir;
}
