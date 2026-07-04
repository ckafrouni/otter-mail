import { toast } from "@glaze/core/components";
import { PaperclipIcon, XIcon } from "lucide-react";
import { gmailApi } from "./api";
import type { ComposeAttachment } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Open the native file picker; the backend enforces the 25 MB total cap. */
export async function pickComposeAttachments(
  existing: ComposeAttachment[],
): Promise<ComposeAttachment[]> {
  const existingBytes = existing.reduce((sum, a) => sum + Math.floor((a.base64.length * 3) / 4), 0);
  try {
    const res = await gmailApi.pickAttachments(existingBytes);
    if (res.error) toast.error(res.error);
    return res.attachments ?? [];
  } catch {
    toast.error("Could not attach files");
    return [];
  }
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
    <div className="flex flex-wrap items-center gap-1.5 border-t border-(--te-border) px-3 py-2">
      {attachments.map((att, i) => (
        <span
          key={`${att.name}:${i}`}
          className="flex max-w-64 items-center gap-1.5 rounded-[4px] border border-(--te-border) bg-(--te-ctl) px-2 py-1 text-[12px] text-(--te-text)"
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
            className="flex min-w-0 items-center gap-1.5 hover:text-(--te-strong)"
          >
            <PaperclipIcon className="size-3 shrink-0 text-(--te-faint)" />
            <span className="min-w-0 truncate">{att.name}</span>
          </button>
          <span className="shrink-0 text-(--te-faint)">{formatBytes(att.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${att.name}`}
            onClick={() => onRemove(i)}
            className="shrink-0 text-(--te-faint) hover:text-(--te-strong)"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
