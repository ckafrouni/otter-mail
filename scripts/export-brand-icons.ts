#!/usr/bin/env node
// Regenerates the app icons from assets/prod/otter-mail-macos-1024.png:
//   assets/dev/blueprint-macos-1024.png   the development ("blueprint") variant
//   apps/desktop/resources/icon.icns      the released app
//   apps/desktop/resources/icon-dev.icns  `pnpm dev` / `pnpm start` builds
//   assets/*/…-ios-1024.png               full-bleed opaque icons for the iPhone app
// macOS only (swift, sips, iconutil). Run with `pnpm icons:export`.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const prodPng = NodePath.join(root, "assets/prod/otter-mail-macos-1024.png");
const devPng = NodePath.join(root, "assets/dev/blueprint-macos-1024.png");
const resources = NodePath.join(root, "apps/desktop/resources");

function run(command: string, args: string[]): void {
  NodeChildProcess.execFileSync(command, args, { stdio: ["ignore", "ignore", "inherit"] });
}

/** Builds an .icns with every size macOS asks for, from a 1024px PNG. */
function icns(png: string, output: string): void {
  const iconset = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-icon-"));
  const dir = `${iconset}/icon.iconset`;
  NodeFS.mkdirSync(dir);
  for (const size of [16, 32, 128, 256, 512]) {
    run("sips", ["-z", `${size}`, `${size}`, png, "--out", `${dir}/icon_${size}x${size}.png`]);
    run("sips", [
      "-z",
      `${size * 2}`,
      `${size * 2}`,
      png,
      "--out",
      `${dir}/icon_${size}x${size}@2x.png`,
    ]);
  }
  run("iconutil", ["-c", "icns", dir, "-o", output]);
  NodeFS.rmSync(iconset, { recursive: true, force: true });
}

run("swift", [NodePath.join(root, "scripts/lib/blueprint-icon.swift"), prodPng, devPng]);
icns(prodPng, NodePath.join(resources, "icon.icns"));
icns(devPng, NodePath.join(resources, "icon-dev.icns"));
const iosIcon = NodePath.join(root, "scripts/lib/ios-icon.swift");
run("swift", [iosIcon, prodPng, NodePath.join(root, "assets/prod/otter-mail-ios-1024.png")]);
run("swift", [iosIcon, devPng, NodePath.join(root, "assets/dev/blueprint-ios-1024.png")]);
console.log(
  "Icons exported: assets/dev/blueprint-macos-1024.png, resources/icon.icns, resources/icon-dev.icns, assets/*/…-ios-1024.png",
);
