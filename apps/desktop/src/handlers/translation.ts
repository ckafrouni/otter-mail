/**
 * Email translation (Apple's on-device translator) and its settings: the
 * languages the user reads, and whether other languages translate by
 * themselves. Translation can outlast the 5s IPC budget, so it runs as a task.
 */

import { ipcMain } from "electron";
import { broadcast } from "../ipc.js";
import { runAsTask } from "./ipc-budget.js";
import { getSettings, updateSettings, type AppSettings } from "../services/settings-store.js";
import { detectLanguage, translateSegments } from "../services/translator.js";

type Params = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

async function translationSettings() {
  const { readLanguages, autoTranslate } = await getSettings();
  return { readLanguages, autoTranslate };
}

export function registerTranslationHandlers(): void {
  ipcMain.handle("translation:getSettings", async () => translationSettings());

  ipcMain.handle("translation:setSettings", async (_event, params: unknown) => {
    const p = params as Params;
    const patch: Partial<AppSettings> = {};
    if (p?.readLanguages !== undefined) {
      const list = p.readLanguages;
      if (
        !Array.isArray(list) ||
        !list.every((c) => typeof c === "string" && LANGUAGE_CODE.test(c))
      )
        throw new Error('Invalid parameter: "readLanguages" must be a list of language codes.');
      patch.readLanguages = [...new Set(list as string[])];
    }
    if (p?.autoTranslate !== undefined) {
      if (typeof p.autoTranslate !== "boolean")
        throw new Error('Invalid parameter: "autoTranslate" must be a boolean.');
      patch.autoTranslate = p.autoTranslate;
    }
    console.log("[translation:setSettings]", patch);
    await updateSettings(patch);
    const settings = await translationSettings();
    broadcast("translation:settingsChanged", settings);
    return settings;
  });

  ipcMain.handle("translation:detect", async (_event, params: unknown) => {
    const text = str((params as Params)?.text);
    if (!text.trim()) return { language: null, confidence: 0 };
    return detectLanguage(text.slice(0, 4000));
  });

  ipcMain.handle("translation:translate", async (_event, params: unknown) => {
    const p = params as Params;
    const segments = p?.segments;
    const source = str(p?.source);
    const target = str(p?.target);
    if (
      !Array.isArray(segments) ||
      !segments.every((s) => typeof s === "string") ||
      !LANGUAGE_CODE.test(source) ||
      !LANGUAGE_CODE.test(target)
    )
      throw new Error("segments, source and target are required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      translateSegments(segments as string[], source, target),
    );
  });
}
