/**
 * Apps launched from Finder inherit launchd's minimal PATH, so CLIs installed
 * by Homebrew, npm or fnm (`codex`) aren't found. Like T3 Code's fixPath, read
 * PATH from the user's login shell once and merge it into process.env.PATH.
 */

import { execFile } from "node:child_process";
import { logger } from "@glaze/core/backend";

const MARKER = "__OTTER_PATH__";

let fixed: Promise<void> | null = null;

function loginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const match = String(stdout ?? "").match(new RegExp(`${MARKER}(.*?)${MARKER}`));
        if (error && !match) logger.info("assistant", "login shell PATH failed", { error: String(error) });
        resolve(match?.[1] ?? null);
      },
    );
  });
}

export function ensureShellPath(): Promise<void> {
  fixed ??= loginShellPath().then((shellPath) => {
    if (!shellPath) return;
    const merged = [...shellPath.split(":"), ...(process.env.PATH ?? "").split(":")].filter(
      (entry, i, all) => entry && all.indexOf(entry) === i,
    );
    process.env.PATH = merged.join(":");
  });
  return fixed;
}
