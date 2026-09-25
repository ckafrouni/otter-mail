/**
 * The pending-approval banner above the chat composer, ported from T3 Code's
 * ComposerBanner (warning) + ComposerPendingApprovalPanel/Actions: what the
 * agent wants to do, Decline / Approve inline, the rest behind "…".
 */

import { EllipsisIcon, ShieldIcon } from "lucide-react";
import type { ApprovalDecision, ApprovalRequest } from "./api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./menu";
import { Btn, cn } from "./ui";

const DETAIL_LABELS: Record<ApprovalRequest["kind"], string> = {
  command: "Command",
  fileChange: "File change",
  permission: "Permission request",
  tool: "Tool call",
};

export function ApprovalBanner({
  approval,
  pendingCount,
  responding,
  onRespond,
  onCancel,
}: {
  approval: ApprovalRequest;
  pendingCount: number;
  responding: boolean;
  onRespond: (decision: ApprovalDecision) => void;
  /** Stops the whole turn (T3's "Cancel" decision). */
  onCancel: () => void;
}) {
  const more: { label: string; run: () => void }[] = [
    { label: "Cancel", run: onCancel },
    ...(approval.choices.includes("session")
      ? [
          {
            label: "Always allow this session",
            run: () => onRespond("session"),
          },
        ]
      : []),
    ...(approval.choices.includes("always")
      ? [{ label: "Always allow", run: () => onRespond("always") }]
      : []),
  ];
  return (
    <div
      role="group"
      aria-label={approval.title}
      className="mb-2 flex items-start gap-x-2 gap-y-3 rounded-2xl border border-warning/24 bg-warning/8 px-3 py-3 outline outline-warning/28 -outline-offset-1 @container/approval"
    >
      <ShieldIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2 @max-[35rem]/approval:gap-3">
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
            <span className="shrink-0 font-medium text-warning">{approval.title}</span>
            {approval.reason ? <span className="min-w-0 truncate">{approval.reason}</span> : null}
            {pendingCount > 1 ? (
              <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
            ) : null}
          </span>
          <code
            aria-label={DETAIL_LABELS[approval.kind]}
            tabIndex={0}
            className="block max-h-20 w-full min-w-0 overflow-auto whitespace-pre font-mono text-xs text-foreground [scrollbar-width:thin]"
          >
            {approval.detail || approval.title}
          </code>
        </span>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More approval options"
                disabled={responding}
                className={cn(
                  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--control-radius) border border-input bg-popover text-muted-foreground shadow-xs/5 hover:text-foreground disabled:opacity-64",
                )}
              >
                <EllipsisIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              {more.map((item) => (
                <DropdownMenuItem key={item.label} onSelect={item.run}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Btn size="xs" variant="outline" disabled={responding} onClick={() => onRespond("deny")}>
            Decline
          </Btn>
          <Btn size="xs" variant="primary" disabled={responding} onClick={() => onRespond("once")}>
            Approve
          </Btn>
        </div>
      </div>
    </div>
  );
}
