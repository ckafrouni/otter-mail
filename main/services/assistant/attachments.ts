/**
 * Files attached to an assistant chat turn (pasted, dropped, or picked).
 * Each is copied into userData/assistant-attachments so the agent reads a
 * stable path that outlives the original (a dragged Downloads file, a pasted
 * screenshot that only ever existed in memory).
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import { app } from "@glaze/core/backend";
import type { ChatAttachment } from "./types.js";

/** Otter Code's limits: 10 MB per image, 50 MB per file. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

function limitFor(mime: string): number {
  return mime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
}

function tooLarge(name: string, mime: string): Error {
  return new Error(`'${name}' exceeds the ${limitFor(mime) / 1024 / 1024} MB attachment limit.`);
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const DOCUMENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".eml": "message/rfc822",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function attachmentsDir(): Promise<string> {
  const dir = path.join(app.getPath("userData"), "assistant-attachments");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function mimeFor(name: string, fallback?: string): string {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_TYPES[ext] ?? DOCUMENT_TYPES[ext] ?? fallback ?? "application/octet-stream";
}

/** Keeps names readable but safe on disk. */
function safeName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w.\- ()]+/g, "_")
    .slice(-120);
  return base || "attachment";
}

async function store(name: string, bytes: Buffer, mime?: string): Promise<ChatAttachment> {
  const type = mimeFor(name, mime);
  if (bytes.byteLength === 0)
    throw new Error(`'${path.basename(name)}' is empty or could not be read.`);
  if (bytes.byteLength > limitFor(type)) throw tooLarge(path.basename(name), type);
  const id = randomUUID();
  const file = path.join(await attachmentsDir(), `${id.slice(0, 8)}-${safeName(name)}`);
  await fs.writeFile(file, bytes);
  return {
    id,
    name: path.basename(name),
    mime: type,
    size: bytes.byteLength,
    path: file,
    kind: type.startsWith("image/") ? "image" : "file",
  };
}

/** A file from Finder (drop or picker), by path. */
export async function stageFromPath(sourcePath: string): Promise<ChatAttachment> {
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error(`${path.basename(sourcePath)} isn't a file.`);
  const type = mimeFor(sourcePath);
  if (stat.size > limitFor(type)) throw tooLarge(path.basename(sourcePath), type);
  return store(sourcePath, await fs.readFile(sourcePath));
}

/** Pasted content (screenshots, copied images): bytes only, no path. */
export async function stageFromBytes(
  name: string,
  mime: string,
  base64: string,
): Promise<ChatAttachment> {
  return store(name, Buffer.from(base64, "base64"), mime);
}

/** `data:` URL of an image attachment, for providers that take inline images. */
export async function dataUrl(attachment: ChatAttachment): Promise<string> {
  const bytes = await fs.readFile(attachment.path);
  return `data:${attachment.mime};base64,${bytes.toString("base64")}`;
}

/**
 * Otter Code's attachment context, appended to the prompt for every
 * attachment (images too: tools can't read inlined pixels, but can read paths).
 */
export function withAttachmentPaths(text: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return text;
  const context = attachments
    .map((a) => `[Attached ${a.kind} "${a.name}" is saved at: ${a.path}]`)
    .join("\n");
  return text ? `${text}\n\n${context}` : context;
}
