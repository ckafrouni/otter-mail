/**
 * translator.ts
 *
 * In-place email translation through Apple's on-device translator (the
 * native/translator helper): language detection and batch translation of a
 * message's text segments. Nothing leaves the Mac. Translations are cached on
 * disk (userData/translation-cache) so reopening a translated email is
 * instant; detection results are cached in memory.
 */

import { app } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "crypto";
import { existsSync } from "node:fs";
import fs from "fs/promises";
import path from "path";

export type LanguageDetection = { language: string | null; confidence: number };

export type TranslationStatus = "ok" | "notInstalled" | "unsupported" | "unavailable";

export type TranslationResult = { status: TranslationStatus; texts: string[] };

const STATUSES: ReadonlySet<string> = new Set(["ok", "notInstalled", "unsupported", "unavailable"]);

const HELPER_TIMEOUT_MS = 60_000;

/** The helper ships in Resources/bin; unpackaged runs use the SwiftPM build. */
function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", "translator");
  const packageDir = path.resolve(__dirname, "..", "..", "..", "native", "translator", ".build");
  const candidates = [
    path.join(packageDir, "release", "translator"),
    path.join(packageDir, "apple", "Products", "Release", "translator"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/** Runs `translator <command>` with `request` as JSON on stdin; resolves with its JSON reply. */
function runHelper(command: "detect" | "translate", request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      helperPath(),
      [command],
      { timeout: HELPER_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`The translator failed: ${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("The translator returned malformed output."));
        }
      },
    );
    child.stdin?.end(JSON.stringify(request));
  });
}

const nativeDetectLanguage = (text: string) => runHelper("detect", { text });
const nativeTranslate = (texts: string[], source: string, target: string) =>
  runHelper("translate", { texts, source, target });

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
