/**
 * Attachments in the assistant chat, as Otter Code does them: paste an image
 * (or files), drop files anywhere on the panel ("Drop files to attach"), or
 * pick them with the paperclip. Files dropped from Finder travel by path;
 * pasted bytes are copied by the backend. Images show as thumbnails, other
 * files as rows, in the composer and in the sent message.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileTextIcon, LoaderCircleIcon, PaperclipIcon, XIcon } from "lucide-react";
import { toast } from "./toast";
import { gmailApi, type ChatAttachment } from "./api";
import { cn } from "./ui";

/** Otter Code's image types, 10 MB per image, 50 MB per file. */
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXTENSIONS = /\.(gif|jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

/** What a sent message keeps (thumbnails are small data URLs, fit for storage). */
export type SentAttachment = { name: string; kind: "image" | "file"; size: number; thumb?: string };

type DraftAttachment = {
  key: string;
  name: string;
  kind: "image" | "file";
  size: number;
  /** Object URL for the composer preview (images). */
  previewUrl?: string;
  thumb?: string;
  staged?: ChatAttachment;
};

export function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function isImage(file: File): boolean {
  return (
    IMAGE_TYPES.has(file.type) ||
    ((!file.type || file.type === "application/octet-stream") && IMAGE_EXTENSIONS.test(file.name))
  );
}

/** A ≤240px JPEG of an image, small enough to keep in the chat history. */
function thumbnail(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 240 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The composer's attachments: add (validate + stage), remove, take on send. */
export function useChatAttachments() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Object URLs die with the draft.
  useEffect(
    () => () => {
      for (const item of itemsRef.current)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const add = async (files: File[]) => {
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    if (files.length > room) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      files = files.slice(0, Math.max(0, room));
    }
    for (const file of files) {
      const image = isImage(file);
      if (!image && file.type.startsWith("image/") && !/heic|heif/i.test(file.type)) {
        toast.error(
          `'${file.name}' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images.`,
        );
        continue;
      }
      if (file.size === 0) {
        toast.error(`'${file.name}' is empty or could not be read.`);
        continue;
      }
      const limit = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (file.size > limit) {
        toast.error(`'${file.name}' exceeds the ${limit / 1024 / 1024} MB attachment limit.`);
        continue;
      }
      const key = crypto.randomUUID();
      const previewUrl = image ? URL.createObjectURL(file) : undefined;
      const name = file.name || (image ? "Pasted image.png" : "Attachment");
      setItems((list) => [
        ...list,
        { key, name, kind: image ? "image" : "file", size: file.size, previewUrl },
      ]);
      void (async () => {
        try {
          // Finder files by path; pasted content has none, so its bytes go.
          const path = window.desktopBridge.getPathForFile(file);
          const item = path
            ? { path }
            : { name, mime: file.type || "application/octet-stream", base64: await base64Of(file) };
          const [thumb, result] = await Promise.all([
            previewUrl ? thumbnail(previewUrl) : Promise.resolve(undefined),
            gmailApi.assistantStageAttachments([item]),
          ]);
          const staged = result.attachments[0];
          if (!staged) throw new Error(result.errors[0] ?? `'${name}' could not be attached.`);
          setItems((list) => list.map((a) => (a.key === key ? { ...a, staged, thumb } : a)));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
          setItems((list) => list.filter((a) => a.key !== key));
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        }
      })();
    }
  };

  const remove = (key: string) =>
    setItems((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((a) => a.key !== key);
    });

  /** Hands the staged files to a send and clears the composer. */
  const take = (): { staged: ChatAttachment[]; sent: SentAttachment[] } => {
    const ready = itemsRef.current.filter((a) => a.staged);
    for (const item of itemsRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems([]);
    return {
      staged: ready.map((a) => a.staged!),
      sent: ready.map((a) => ({ name: a.name, kind: a.kind, size: a.size, thumb: a.thumb })),
    };
  };

  return {
    items,
    add,
    remove,
    take,
    staging: items.some((a) => !a.staged),
    count: items.length,
  };
}

// ---------------------------------------------------------------------------
// Drop target (the whole panel)
// ---------------------------------------------------------------------------

const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");
const movedWithin = (e: DragEvent) =>
  e.relatedTarget !== null && e.currentTarget.contains(e.relatedTarget as Node);

/** Otter Code's workspace file drop: handlers for the panel + overlay state. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false);
  // Cancelling a drag with Escape may never fire dragleave.
  useEffect(() => {
    const clear = () => setActive(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);
  return {
    active,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        if (!movedWithin(e)) setActive(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setActive(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        if (!movedWithin(e)) setActive(false);
      },
      onDrop: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setActive(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]">
      <div
        role="status"
        className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
      >
        <PaperclipIcon className="size-4 text-primary" aria-hidden />
        Drop files to attach
      </div>
    </div>
  );
}

/** Otter Code's paste rule: images (or files without text) attach; text pastes. */
export function filesFromPaste(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length === 0) return [];
  const text = data.getData("text/plain");
  if (files.some((f) => f.type.startsWith("image/"))) return files;
  return text ? [] : files;
}

// ---------------------------------------------------------------------------
// Composer strip + sent message
// ---------------------------------------------------------------------------

export function ComposerAttachments({
  items,
  onRemove,
}: {
  items: DraftAttachment[];
  onRemove: (key: string) => void;
}) {
  const images = items.filter((a) => a.kind === "image");
  const files = items.filter((a) => a.kind === "file");
  if (items.length === 0) return null;
  return (
    <div className="px-4 pt-3">
      {images.length > 0 ? (
        <div className="mb-2 flex max-w-full flex-wrap gap-2">
          {images.map((image) => (
            <div
              key={image.key}
              className="group/attachment relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-background"
            >
              {image.previewUrl ? (
                <img
                  className="h-full w-full object-cover"
                  alt={image.name}
                  src={image.previewUrl}
                />
              ) : (
                <span className="flex h-full items-center justify-center px-1 text-[10px] text-secondary-label">
                  {image.name}
                </span>
              )}
              {!image.staged ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50">
                  <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(image.key)}
                aria-label={`Remove ${image.name}`}
                className="absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/attachment:opacity-100 focus-visible:opacity-100"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="mb-2 flex flex-col gap-1">
          {files.map((file) => (
            <div
              key={file.key}
              className="flex min-w-0 items-center gap-2 py-1 text-sm text-foreground"
            >
              {file.staged ? (
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-secondary-label">
                {formatAttachmentSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(file.key)}
                aria-label={`Remove ${file.name}`}
                className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--control-radius) text-muted-foreground hover:bg-accent-surface hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Attachments inside a sent user bubble (Otter Code's MessagesTimeline). */
export function SentAttachments({ attachments }: { attachments: SentAttachment[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  return (
    <>
      {images.length > 0 ? (
        <div
          className={cn(
            "mb-2 grid max-w-[210px] gap-2",
            images.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {images.map((image, i) => (
            <div
              key={i}
              className="aspect-[4/3] overflow-hidden rounded-lg border border-border/80 bg-background/70"
              title={image.name}
            >
              {image.thumb ? (
                <img src={image.thumb} alt={image.name} className="block size-full object-cover" />
              ) : (
                <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                  {image.name}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="mb-2 flex flex-col gap-1">
          {files.map((file, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
              <FileTextIcon className="size-4 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs opacity-60">{formatAttachmentSize(file.size)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
