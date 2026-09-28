/** Logging for core: the shell decides where lines go (terminal and log file, or the console). */

import { platform } from "./platform.js";

export const logger = {
  debug: (scope: string, message: string, data?: unknown) =>
    platform().log("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) =>
    platform().log("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) =>
    platform().log("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) =>
    platform().log("error", scope, message, data),
};
