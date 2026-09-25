#!/usr/bin/env node
// Resolves the version, tag and release name of a nightly build.
//
//   node scripts/resolve-nightly-release.ts --date 20260925 --run-number 3 --sha <sha> [--github-output]
//
// The nightly version previews the next patch release: with
// apps/desktop/package.json at 0.1.0 it is 0.1.1-nightly.20260925.3.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

export function resolveNightlyTargetVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) throw new Error(`Invalid desktop package version "${version}".`);
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

export function resolveNightlyReleaseMetadata(input: {
  baseVersion: string;
  date: string;
  runNumber: number;
  sha: string;
}) {
  const shortSha = input.sha.slice(0, 12);
  const version = `${input.baseVersion}-nightly.${input.date}.${input.runNumber}`;
  return {
    base_version: input.baseVersion,
    version,
    tag: `v${version}`,
    name: `Otter Mail Nightly ${version} (${shortSha})`,
    short_sha: shortSha,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      date: { type: "string" },
      "run-number": { type: "string" },
      sha: { type: "string" },
      root: { type: "string" },
      "github-output": { type: "boolean", default: false },
    },
  });
  const date = values.date ?? "";
  const runNumber = Number(values["run-number"]);
  const sha = values.sha ?? "";
  if (!/^\d{8}$/.test(date)) throw new Error("--date must be YYYYMMDD.");
  if (!Number.isInteger(runNumber) || runNumber < 1) {
    throw new Error("--run-number must be a positive integer.");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("--sha must be a commit sha.");

  const packageJsonPath = NodePath.join(
    NodePath.resolve(values.root ?? repoRoot),
    "apps/desktop/package.json",
  );
  const { version } = JSON.parse(NodeFS.readFileSync(packageJsonPath, "utf8")) as {
    version: string;
  };
  const metadata = resolveNightlyReleaseMetadata({
    baseVersion: resolveNightlyTargetVersion(version),
    date,
    runNumber,
    sha,
  });
  const lines = Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`);

  if (values["github-output"]) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) throw new Error("GITHUB_OUTPUT is not set.");
    NodeFS.appendFileSync(outputPath, lines.join(""));
  } else {
    process.stdout.write(lines.join(""));
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      `[resolve-nightly-release] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
