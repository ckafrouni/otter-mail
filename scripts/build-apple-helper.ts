#!/usr/bin/env node
// Builds the native/apple-helper Swift helper (Apple's on-device Translation and
// Foundation Models).
//
//   node scripts/build-apple-helper.ts              host architecture, release
//   node scripts/build-apple-helper.ts --universal  arm64 + x86_64, for packaging
//
// Needs full Xcode (not just the Command Line Tools) with a macOS 26 SDK.
// Prints the path of the built binary on the last line of stdout.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parseArgs } from "node:util";

export const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
export const helperPackageDir = NodePath.join(repoRoot, "native", "apple-helper");
const buildDir = NodePath.join(helperPackageDir, ".build");
// Where `swift build -c release` leaves the binary. Multi-arch builds go
// through Xcode's build system, whose output folder depends on the Swift
// version: .build/apple/... up to Swift 6.2, .build/out/... from 6.3.
export const helperBinaryPaths = {
  host: [NodePath.join(buildDir, "release", "apple-helper")],
  universal: [
    NodePath.join(buildDir, "out", "Products", "Release", "apple-helper"),
    NodePath.join(buildDir, "apple", "Products", "Release", "apple-helper"),
  ],
} as const;

/** The newest existing helper build of the given kind, if any. */
export function findHelperBinary(kind: "host" | "universal"): string | undefined {
  return helperBinaryPaths[kind]
    .filter((path) => NodeFS.existsSync(path))
    .sort((a, b) => NodeFS.statSync(b).mtimeMs - NodeFS.statSync(a).mtimeMs)[0];
}

/** Why the helper cannot be built on this machine, or null when it can. */
export function helperToolchainProblem(): string | null {
  if (process.platform !== "darwin") {
    return "The Apple helper uses Apple's frameworks and only builds on macOS.";
  }
  const xcodebuild = NodeChildProcess.spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  if (xcodebuild.error || xcodebuild.status !== 0) {
    const details = `${xcodebuild.stderr ?? ""}${xcodebuild.error?.message ?? ""}`.trim();
    return [
      "Full Xcode is required to build native/apple-helper (the Command Line Tools are not enough).",
      "Install Xcode from the App Store, then run:",
      "  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
      details ? `xcodebuild said: ${details}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return null;
}

export function buildHelper(options: { universal: boolean; quiet?: boolean }): string {
  const problem = helperToolchainProblem();
  if (problem) throw new Error(problem);

  const args = ["build", "-c", "release", "--package-path", helperPackageDir];
  if (options.universal) args.push("--arch", "arm64", "--arch", "x86_64");
  const result = NodeChildProcess.spawnSync("swift", args, {
    cwd: repoRoot,
    stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  if (result.error) throw new Error(`Could not run swift: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`swift ${args.join(" ")} failed with exit code ${result.status}.`);
  }

  const binPath = NodeChildProcess.spawnSync("swift", [...args, "--show-bin-path"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = NodePath.join(binPath.stdout.trim(), "apple-helper");
  if (binPath.status !== 0 || !NodeFS.existsSync(output)) {
    throw new Error(
      `swift build succeeded but the apple-helper binary was not found at ${output}.`,
    );
  }
  return output;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      universal: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log("Usage: node scripts/build-apple-helper.ts [--universal]");
    process.exit(0);
  }
  try {
    const output = buildHelper({ universal: values.universal });
    console.log(output);
  } catch (error) {
    console.error(`[build-apple-helper] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
