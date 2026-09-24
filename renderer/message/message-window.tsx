import { useEffect, useState } from "react";
import { MessageReader } from "../main/gmail/message-reader";
import { HermesChatPanel } from "../main/gmail/hermes-chat";
import { isTypingTarget } from "../main/gmail/keyboard";
import { applyAppTheme, startAppTheme } from "../main/theme/apply-theme";
import type { QuoteContext } from "../main/gmail/chat-context";

// Color theme (Settings → Appearance), applied before first paint.
applyAppTheme();

/**
 * Standalone single-message window: just the reader for one conversation and
 * the Hermes chat panel, on the glass frame. No sidebar, list, or switcher —
 * the target rides in the URL query.
 */
export function MessageWindow() {
  // Re-theme on appearance switches and on theme picks from any window.
  useEffect(() => startAppTheme(), []);

  const params = new URLSearchParams(window.location.search);
  const accountId = params.get("account") ?? "";
  const messageId = params.get("message") ?? "";

  // Chat collapsed by default; ⌘I toggles it (same as the main window).
  const [chatOpen, setChatOpen] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "i" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (isTypingTarget(e)) return;
        e.preventDefault();
        setChatOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  if (!accountId || !messageId) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted-foreground">
        No message to show.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-foreground">
      {/* Drag strip + native traffic-light clearance (matches the main TopBar). */}
      <div className="drag-region h-11 shrink-0" />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden bg-canvas">
          <MessageReader
            accountId={accountId}
            messageId={messageId}
            onOpenChat={() => setChatOpen(true)}
            onQuote={(q) => {
              if (chatOpen) setPendingQuote(q);
            }}
          />
        </div>
        {chatOpen ? (
          <div className="w-[360px] shrink-0 overflow-hidden border-l border-border bg-card">
            <HermesChatPanel
              accountId={accountId}
              messageId={messageId}
              quote={pendingQuote}
              onClearQuote={() => setPendingQuote(null)}
              onClose={() => setChatOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
