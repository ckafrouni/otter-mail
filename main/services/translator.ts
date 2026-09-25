/**
 * translator.ts
 *
 * In-place email translation through Apple's on-device translator (the
 * native/translator helper): language detection and batch translation of a
 * message's text segments. Nothing leaves the Mac. Translations are cached on
 * disk (userData/translation-cache) so reopening a translated email is
 * instant; detection results are cached in memory.
 */

import { app } from "@glaze/core/backend";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  detectLanguage as nativeDetectLanguage,
  translate as nativeTranslate,
} from "swift:../../native/translator";

export type LanguageDetection = { language: string | null; confidence: number };

export type TranslationStatus = "ok" | "notInstalled" | "unsupported" | "unavailable";

export type TranslationResult = { status: TranslationStatus; texts: string[] };

const STATUSES: ReadonlySet<string> = new Set(["ok", "notInstalled", "unsupported", "unavailable"]);

const MAX_DETECTIONS = 500;
const detections = new Map<string, LanguageDetection>();

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function detectLanguage(text: string): Promise<LanguageDetection> {
  const key = hash(text);
  const cached = detections.get(key);
  if (cached) return cached;
  const raw = (await nativeDetectLanguage(text)) as Partial<LanguageDetection> | null;
  const result: LanguageDetection = {
    language: typeof raw?.language === "string" ? raw.language : null,
    confidence: typeof raw?.confidence === "number" ? raw.confidence : 0,
  };
  if (detections.size >= MAX_DETECTIONS) {
    const oldest = detections.keys().next().value;
    if (oldest !== undefined) detections.delete(oldest);
  }
  detections.set(key, result);
  return result;
}

let dirPromise: Promise<string> | null = null;
function getCacheDir(): Promise<string> {
  dirPromise ??= (async () => {
    const dir = path.join(app.getPath("userData"), "translation-cache");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  })();
  return dirPromise;
}

export async function translateSegments(
  segments: string[],
  source: string,
  target: string,
): Promise<TranslationResult> {
  const cacheFile = path.join(
    await getCacheDir(),
    hash(JSON.stringify([source, target, segments])) + ".json",
  );
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8")) as unknown;
    if (Array.isArray(cached) && cached.length === segments.length) {
      return { status: "ok", texts: cached as string[] };
    }
  } catch {
    // Not cached yet.
  }

  const startedAt = Date.now();
  const raw = (await nativeTranslate(segments, source, target)) as Partial<TranslationResult>;
  const status = (
    STATUSES.has(String(raw?.status)) ? raw.status : "unsupported"
  ) as TranslationStatus;
  const texts = Array.isArray(raw?.texts) ? raw.texts.map(String) : [];
  console.log("[translator:translate]", {
    source,
    target,
    segments: segments.length,
    status,
    ms: Date.now() - startedAt,
  });
  if (status !== "ok") return { status, texts: [] };
  if (texts.length !== segments.length)
    throw new Error("The translator returned an incomplete result.");
  // Best-effort: a cache failure must never break translation.
  await fs.writeFile(cacheFile, JSON.stringify(texts), "utf-8").catch(() => {});
  return { status, texts };
}
