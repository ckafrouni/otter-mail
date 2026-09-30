/**
 * The native/apple-helper binary: Apple's on-device frameworks for the Mac
 * app, Translation (translator.ts) and Foundation Models (agent/apple.ts).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { appInfo } from "../backend-protocol.js";

const TIMEOUT_MS = 60_000;

/** The helper ships in Resources/bin; unpackaged runs use the SwiftPM build. */
export function helperPath(): string {
  const { packaged, resourcesPath } = appInfo();
  if (packaged) return path.join(resourcesPath, "bin", "apple-helper");
  const buildDir = path.resolve(__dirname, "..", "..", "..", "native", "apple-helper", ".build");
  const candidates = [
    path.join(buildDir, "release", "apple-helper"),
    path.join(buildDir, "apple", "Products", "Release", "apple-helper"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/** Runs a one-shot command with `request` as JSON on stdin; resolves with its JSON reply. */
export function runHelper(command: string, request: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      helperPath(),
      [command],
      { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`apple-helper ${command} failed: ${stderr.trim() || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`apple-helper ${command} returned malformed output.`));
        }
      },
    );
    child.stdin?.end(JSON.stringify(request));
  });
}
