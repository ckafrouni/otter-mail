/**
 * Main-process logger: console plus a rolling file at <userData>/logs/main.log
 * (app.getPath("logs"), see paths.ts).
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";

type Level = "debug" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let streamFailed = false;

function logStream(): fs.WriteStream | null {
  if (stream || streamFailed) return stream;
  try {
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "main.log");
    // One generation of history is plenty for bug reports.
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(dir, "main.old.log"));
    }
    stream = fs.createWriteStream(file, { flags: "a" });
  } catch {
    streamFailed = true;
  }
  return stream;
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  return inspect(value, { depth: 4, breakLength: Infinity });
}

function write(level: Level, scope: string, message: string, data?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${
    data === undefined ? "" : ` ${format(data)}`
  }`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  logStream()?.write(line + "\n");
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => {
    if (!app.isPackaged) write("debug", scope, message, data);
  },
  info: (scope: string, message: string, data?: unknown) => write("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => write("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => write("error", scope, message, data),
};
