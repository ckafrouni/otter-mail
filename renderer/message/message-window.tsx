import { useEffect, useState } from "react";
import { injectActiveTheme } from "@glaze/core/components";
import { MessageReader } from "../main/gmail/message-reader";
import { HermesChatPanel } from "../main/gmail/hermes-chat";
import { isTypingTarget } from "../main/gmail/keyboard";
import { TE_DARK_THEME, TE_LIGHT_THEME } from "../main/gmail/te-theme";
import type { QuoteContext } from "../main/gmail/ask-assistant";

// Same TE glass skin as the main window, following the system appearance.
function applyTeTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  injectActiveTheme(dark ? TE_DARK_THEME : TE_LIGHT_THEME);
}
applyTeTheme();

/**
 * Standalone single-message window: just the reader for one conversation and
 * the Hermes chat panel, on the glass frame. No sidebar, list, or switcher —
 * the target rides in the URL query.
 */
export function MessageWindow() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTeTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
      <div className="flex h-full items-center justify-center bg-(--te-frame) text-[13px] text-(--te-muted)">
        No message to show.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-(--te-frame) text-(--te-text)">
      {/* Drag strip + native traffic-light clearance (matches the main TopBar). */}
      <div className="drag-region h-11 shrink-0" />
      <div className="flex min-h-0 flex-1 gap-1 px-1 pb-1">
        <div
          className={`min-w-0 flex-1 overflow-hidden rounded-[10px] rounded-bl-[16px] border border-(--te-border) bg-(--te-card-glass) ${
            chatOpen ? "" : "rounded-br-[16px]"
          }`}
        >
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
          <div className="w-[360px] shrink-0 overflow-hidden rounded-[10px] rounded-br-[16px] border border-(--te-border) bg-(--te-card)">
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
