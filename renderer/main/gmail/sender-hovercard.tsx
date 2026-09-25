import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "@glaze/core/components";
import { CopyIcon, SearchIcon, SparklesIcon, SquarePenIcon } from "lucide-react";
import { SenderAvatar } from "./sender-avatar";

/**
 * Hover card for a message sender: identity + quick actions. Portaled to body
 * so it can't be clipped by the reader panes; opens on hover with a short
 * delay and stays open while the pointer is over the card.
 */
export function SenderHoverCard({
  name,
  email,
  accountId,
  onCompose,
  onSearch,
  onAsk,
  children,
}: {
  name: string;
  email: string;
  accountId: string;
  onCompose?: (email: string) => void;
  onSearch?: (email: string) => void;
  onAsk?: (email: string, name: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ x: r.left, y: r.bottom + 6 });
      setOpen(true);
    }, 350);
  };
  const hide = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 160);
  };

  const displayName = name || email;

  const copyEmail = () => {
    void navigator.clipboard?.writeText(email).then(
      () => toast.success("Email copied"),
      () => toast.error("Couldn't copy"),
    );
    setOpen(false);
  };

  const Action = ({
    icon,
    label,
    onClick,
  }: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-accent-surface"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      {label}
    </button>
  );

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="inline-flex cursor-default"
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              style={{ left: pos.x, top: pos.y }}
              onMouseEnter={clearTimers}
              onMouseLeave={hide}
              className="dropdown-glass fixed z-50 w-64 rounded-lg p-3 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
            >
              <div className="flex items-center gap-2.5">
                <SenderAvatar name={name} email={email} accountId={accountId} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {displayName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground/70">{email}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-1.5">
                {onCompose ? (
                  <Action
                    icon={<SquarePenIcon className="size-3.5" />}
                    label="New message"
                    onClick={() => {
                      onCompose(email);
                      setOpen(false);
                    }}
                  />
                ) : null}
                {onSearch ? (
                  <Action
                    icon={<SearchIcon className="size-3.5" />}
                    label="Find emails"
                    onClick={() => {
                      onSearch(email);
                      setOpen(false);
                    }}
                  />
                ) : null}
                {onAsk ? (
                  <Action
                    icon={<SparklesIcon className="size-3.5" />}
                    label="Ask the assistant about them"
                    onClick={() => {
                      onAsk(email, displayName);
                      setOpen(false);
                    }}
                  />
                ) : null}
                <Action
                  icon={<CopyIcon className="size-3.5" />}
                  label="Copy address"
                  onClick={copyEmail}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
