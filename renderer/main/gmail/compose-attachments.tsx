import { useRef, useState, type DragEvent } from "react";
import { toast } from "@glaze/core/components";
import { PaperclipIcon, XIcon } from "lucide-react";
import { gmailApi } from "./api";
import type { ComposeAttachment } from "./types";

/** Mirror of the backend cap (gmail-api.ts) so renderer-side drops fail early. */
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentBytes(a: ComposeAttachment): number {
  return a.size || Math.floor((a.base64.length * 3) / 4);
}

/** Open the native file picker; the backend enforces the 25 MB total cap. */
export async function pickComposeAttachments(
  existing: ComposeAttachment[],
): Promise<ComposeAttachment[]> {
  const existingBytes = existing.reduce((sum, a) => sum + attachmentBytes(a), 0);
  try {
    const res = await gmailApi.pickAttachments(existingBytes);
    if (res.error) toast.error(res.error);
    return res.attachments ?? [];
  } catch {
    toast.error("Could not attach files");
    return [];
  }
}

function readFileAsAttachment(file: File): Promise<ComposeAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      // FileReader gives a `data:<mime>;base64,<payload>` URL — keep the payload.
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({
        name: file.name || "attachment",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64: comma >= 0 ? result.slice(comma + 1) : "",
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Read dropped/pasted files into attachments in the renderer (base64), skipping
 * any that would push the running total past the 25 MB cap.
 */
export async function filesToComposeAttachments(
  files: File[],
  existing: ComposeAttachment[],
): Promise<ComposeAttachment[]> {
  let total = existing.reduce((sum, a) => sum + attachmentBytes(a), 0);
  const out: ComposeAttachment[] = [];
  let skipped = false;
  for (const file of files) {
    if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
      skipped = true;
      continue;
    }
    try {
      out.push(await readFileAsAttachment(file));
      total += file.size;
    } catch {
      skipped = true;
    }
  }
  if (skipped) toast.error("Some files were skipped (25 MB total limit)");
  return out;
}

/**
 * Gmail-style drag-and-drop: drop files anywhere on the composer to attach.
 * Returns `dropProps` to spread on the drop container and `isDragging` for the
 * overlay. Ignores internal drags (e.g. dragging an attachment out to Finder),
 * which carry no `Files` type.
 */
export function useComposeFileDrop(
  onFiles: (files: File[]) => void,
  disabled?: boolean,
): { isDragging: boolean; dropProps: Record<string, (e: DragEvent) => void> } {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);
  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return {
    isDragging,
    dropProps: {
      onDragEnter: (e) => {
        if (disabled || !carriesFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setIsDragging(true);
      },
      onDragOver: (e) => {
        if (disabled || !carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e) => {
        if (disabled || !carriesFiles(e)) return;
        // dragenter/leave fire per child element; count depth so leaving a child
        // doesn't dismiss the overlay while still over the container.
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setIsDragging(false);
        }
      },
      onDrop: (e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setIsDragging(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}

/** Full-cover "Drop files to attach" hint; pointer-events-none so the drop lands on the container. */
export function ComposeDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035] text-foreground backdrop-blur-sm">
      <PaperclipIcon className="size-6 text-primary" />
      <span className="text-sm font-semibold">Drop files to attach</span>
    </div>
  );
}

/** Stable signature for autosave dirty-checks. */
export function attachmentSignature(attachments: ComposeAttachment[] | null): string {
  return (attachments ?? []).map((a) => `${a.name}:${a.size}`).join("|");
}

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ComposeAttachment[] | null;
  onRemove: (index: number) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
      {attachments.map((att, i) => (
        <span
          key={`${att.name}:${i}`}
          className="flex h-6 max-w-64 items-center gap-1.5 rounded-md border border-border bg-secondary px-2 text-xs text-foreground"
        >
          <button
            type="button"
            title={att.name}
            aria-label={`Open ${att.name}`}
            onClick={() => {
              void gmailApi
                .openComposeAttachment({ name: att.name, base64: att.base64 })
                .catch(() => toast.error("Could not open attachment"));
            }}
            className="flex min-w-0 items-center gap-1.5 hover:text-foreground"
          >
            <PaperclipIcon className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 truncate">{att.name}</span>
          </button>
          <span className="shrink-0 text-muted-foreground/70">{formatBytes(att.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${att.name}`}
            onClick={() => onRemove(i)}
            className="shrink-0 text-muted-foreground/70 hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
