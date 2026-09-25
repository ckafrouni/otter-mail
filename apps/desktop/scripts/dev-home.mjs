// Which data home a development run uses, as in T3 Code (packages/shared/src/devHome.ts):
//
//   --home <dir>  >  <linked worktree>/.otter-mail  >  ambient OTTER_MAIL_HOME  >  unset
//
// Unset lets the app use ~/.otter-mail/dev (apps/desktop/src/paths.ts). The
// worktree default outranks an ambient OTTER_MAIL_HOME on purpose: any explicit
// home selects its `userdata` state dir, so an inherited variable pointing at
// ~/.otter-mail would put a throwaway branch on the installed app's database.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * The linked git worktree containing `cwd`, or undefined (main checkout, submodule,
 * not a repo). A linked worktree's `.git` is a file whose gitdir ends in
 * `worktrees/<name>`; a submodule's points into `modules/<name>` instead.
 */
export function resolveLinkedWorktree(cwd) {
  let directory = NodePath.resolve(cwd);
  for (;;) {
    const gitPath = NodePath.join(directory, ".git");
    let stat = null;
    try {
      stat = NodeFS.statSync(gitPath);
    } catch {
      // Keep walking up.
    }
    if (stat) {
      if (!stat.isFile()) return undefined;
      const gitdir = NodeFS.readFileSync(gitPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("gitdir:"))
        ?.slice("gitdir:".length)
        .trim();
      const segments = (gitdir ?? "").split(/[/\\]/).filter(Boolean);
      return segments.length >= 3 && segments.at(-2) === "worktrees" ? directory : undefined;
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** The OTTER_MAIL_HOME for a dev run, or undefined for the app's default dev home. */
export function resolveDevHome({ cwd, explicitHome, env = process.env }) {
  const explicit = explicitHome?.trim();
  if (explicit) return NodePath.resolve(explicit);
  const worktree = resolveLinkedWorktree(cwd);
  if (worktree) return NodePath.join(worktree, ".otter-mail");
  const ambient = env.OTTER_MAIL_HOME?.trim();
  return ambient ? NodePath.resolve(ambient) : undefined;
}
