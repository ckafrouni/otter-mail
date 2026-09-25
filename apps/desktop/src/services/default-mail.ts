/**
 * Default-mail-app inspection and selection. Electron only covers
 * registering *this* app (`app.setAsDefaultProtocolClient`), so enumerating
 * installed mailto handlers and handing the default to another app goes
 * through LaunchServices via osascript/JXA. Values cross into the scripts as
 * argv, never by string interpolation.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MailApp = { bundleId: string; name: string; path: string };
export type MailAppsResult = { apps: MailApp[]; defaultBundleId: string | null };

async function runJxa(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    script,
    ...args,
  ]);
  return stdout.trim();
}

const LIST_SCRIPT = `
ObjC.import("AppKit");
function run() {
  const ws = $.NSWorkspace.sharedWorkspace;
  const url = $.NSURL.URLWithString("mailto:probe@example.com");
  const fm = $.NSFileManager.defaultManager;
  const bundleIdAt = (u) => {
    const b = $.NSBundle.bundleWithURL(u);
    if (b.isNil()) return null;
    const bid = b.bundleIdentifier;
    return bid.isNil() ? null : bid.js;
  };
  const apps = [];
  const urls = ws.URLsForApplicationsToOpenURL(url);
  for (let i = 0; i < urls.count; i++) {
    const u = urls.objectAtIndex(i);
    const bundleId = bundleIdAt(u);
    if (!bundleId) continue;
    apps.push({
      bundleId,
      path: u.path.js,
      name: fm.displayNameAtPath(u.path).js.replace(/\\.app$/, ""),
    });
  }
  const def = ws.URLForApplicationToOpenURL(url);
  return JSON.stringify({
    apps,
    defaultBundleId: def.isNil() ? null : bundleIdAt(def),
  });
}
`;

const SET_SCRIPT = `
ObjC.import("CoreServices");
function run(argv) {
  const status = $.LSSetDefaultHandlerForURLScheme($("mailto"), $(argv[0]));
  return JSON.stringify({ status });
}
`;

export async function listMailApps(): Promise<MailAppsResult> {
  const parsed = JSON.parse(await runJxa(LIST_SCRIPT)) as MailAppsResult;
  const seen = new Set<string>();
  const apps = parsed.apps.filter((a) => {
    if (seen.has(a.bundleId)) return false;
    seen.add(a.bundleId);
    return true;
  });
  return { apps, defaultBundleId: parsed.defaultBundleId };
}

export async function setDefaultMailHandler(bundleId: string): Promise<void> {
  const { status } = JSON.parse(await runJxa(SET_SCRIPT, [bundleId])) as { status: number };
  if (status !== 0) {
    throw new Error(`LSSetDefaultHandlerForURLScheme failed with status ${status}`);
  }
}
