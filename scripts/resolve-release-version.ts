#!/usr/bin/env node
// Picks the version of the next stable release.
//
//   node scripts/resolve-release-version.ts [--version 1.2.3 | --tag v1.2.3 | --bump patch|minor|major]
//                                           [--github-output]
//
// An explicit --version or a pushed --tag wins. Otherwise the latest vX.Y.Z tag
// is bumped; the very first release ships apps/desktop/package.json's version.
// Prints (or appends to $GITHUB_OUTPUT) version, tag, name, prerelease,
// make_latest and previous_tag.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const ANY = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

type Bump = "patch" | "minor" | "major";

export function bumpVersion(version: string, bump: Bump): string {
  const match = STABLE.exec(version);
  if (!match) throw new Error(`Not a stable version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Stable vX.Y.Z tags, newest first. */
function stableTags(): string[] {
  const out = NodeChildProcess.execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\n").filter((tag) => STABLE.test(tag));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      tag: { type: "string" },
      bump: { type: "string", default: "patch" },
      "github-output": { type: "boolean", default: false },
    },
  });
  const tags = stableTags();
  const explicit = (values.version?.trim() || values.tag?.trim() || "").replace(/^v/, "");
  let version: string;
  if (explicit) {
    version = explicit;
  } else if (tags[0]) {
    const bump = values.bump as Bump;
    if (!["patch", "minor", "major"].includes(bump)) throw new Error(`Unknown bump: ${bump}`);
    version = bumpVersion(tags[0], bump);
  } else {
    const pkg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
    ) as { version: string };
    version = pkg.version;
  }
  if (!ANY.test(version)) throw new Error(`Invalid release version: ${version}`);
  const tag = `v${version}`;
  // A pushed tag already exists; a dispatched release must not reuse one.
  if (!values.tag && tags.includes(tag)) throw new Error(`${tag} was already released.`);

  const stable = STABLE.test(version);
  const outputs = {
    version,
    tag,
    name: `Otter Mail ${version}`,
    prerelease: String(!stable),
    make_latest: String(stable),
    previous_tag: tags.find((t) => t !== tag) ?? "",
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (values["github-output"] && process.env.GITHUB_OUTPUT) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  console.log(lines.join("\n"));
}

if (import.meta.main) main();
