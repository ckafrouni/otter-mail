import { useEffect, useState } from "react";
import { injectActiveTheme } from "@glaze/core/components";
import { MessageReader } from "../main/gmail/message-reader";
import { HermesChatPanel } from "../main/gmail/hermes-chat";
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

  // A highlighted excerpt handed to the always-open chat panel.
  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);

  if (!accountId || !messageId) {
    return (
      <div className="flex h-full items-center justify-center bg-(--te-frame) text-[13px] text-(--te-muted)">
        No message to show.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-(--te-frame) text-(--te-text)">
      {/* Drag strip + native traffic-light clearance. */}
      <div className="drag-region h-9 shrink-0" />
      <div className="flex min-h-0 flex-1 gap-1 px-1 pb-1">
        <div className="min-w-0 flex-1 overflow-hidden rounded-[10px] rounded-bl-[16px] border border-(--te-border) bg-(--te-card-glass)">
          <MessageReader
            accountId={accountId}
            messageId={messageId}
            onQuote={(q) => setPendingQuote(q)}
          />
        </div>
        <div className="w-[360px] shrink-0 overflow-hidden rounded-[10px] rounded-br-[16px] border border-(--te-border) bg-(--te-card)">
          <HermesChatPanel
            accountId={accountId}
            messageId={messageId}
            quote={pendingQuote}
            onClearQuote={() => setPendingQuote(null)}
            onClose={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
