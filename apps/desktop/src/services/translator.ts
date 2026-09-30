/**
 * translator.ts
 *
 * The Mac's on-device translator for core (Platform.translator): Apple's
 * Translation through the Apple helper. Nothing leaves the Mac; core caches
 * the results.
 */

import type { TranslationStatus, Translator } from "@otter-mail/core";

import { runHelper } from "./apple-helper.js";

const STATUSES: ReadonlySet<string> = new Set(["ok", "notInstalled", "unsupported", "unavailable"]);

export const appleTranslator: Translator = {
  async detect(text) {
    const raw = (await runHelper("detect", { text })) as {
      language?: unknown;
      confidence?: unknown;
    } | null;
    return {
      language: typeof raw?.language === "string" ? raw.language : null,
      confidence: typeof raw?.confidence === "number" ? raw.confidence : 0,
    };
  },
  async translate(texts, source, target) {
    const startedAt = Date.now();
    const raw = (await runHelper("translate", { texts, source, target })) as {
      status?: unknown;
      texts?: unknown;
    } | null;
    const status = (
      STATUSES.has(String(raw?.status)) ? raw!.status : "unsupported"
    ) as TranslationStatus;
    console.log("[translator:translate]", {
      source,
      target,
      segments: texts.length,
      status,
      ms: Date.now() - startedAt,
    });
    return { status, texts: Array.isArray(raw?.texts) ? raw.texts.map(String) : [] };
  },
};
