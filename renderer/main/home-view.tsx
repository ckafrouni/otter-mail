import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EmptyState, Button, toast } from "@glaze/core/components";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { NewMessageView } from "./gmail/new-message-view";
import { CommandPalette } from "./gmail/command-palette";
import { HermesChatPanel } from "./gmail/hermes-chat";
import { ShortcutsHelpDialog } from "./gmail/shortcuts-help-dialog";
import { TopBar } from "./gmail/top-bar";
import { isTypingTarget } from "./gmail/keyboard";
import {
  useCredentials,
  useAccounts,
  useAddAccount,
  useAccountSync,
  useGlobalSyncStatus,
  useModifyMessage,
  useModifyThread,
  useUntrashThread,
  useUntrashMessage,
} from "./gmail/hooks";
import { takeUndo, type UndoAction } from "./gmail/undo";
import { getAccountColor, getAccountContrastColor } from "./gmail/account-style";
import { gmailApi, type MailtoTarget } from "./gmail/api";
import type { GmailMessageSummary } from "./gmail/types";
import {
  useMailViews,
  resolveRules,
  loadLastLocation,
  saveLastLocation,
  COMBINED_ACCOUNT_ID,
  INBOX_VIEW_ID,
  SENT_VIEW_ID,
  STARRED_VIEW_ID,
  DRAFTS_VIEW_ID,
} from "./gmail/custom-views";

/** A place the user was at, for the top-bar back/forward buttons. */
type NavLoc = {
  accountId: string | null;
  labelId: string;
  messageId: string | null;
  readerAccountId: string | null;
};

/** Drag-resizable pane width persisted to localStorage. */
function useStoredWidth(key: string, def: number, min: number, max: number, dir: 1 | -1 = 1) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : def;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const move = (ev: PointerEvent) => {
      // dir -1: right-side panes grow when the handle drags left.
      setWidth(Math.min(max, Math.max(min, startW + dir * (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem(key, String(widthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { width, start };
}

/** The 4px gap between panel cards doubles as the resize handle. */
function PaneResizer({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="group flex w-1 shrink-0 cursor-col-resize justify-center"
      aria-hidden
    >
      <div className="w-px group-hover:bg-(--te-outline)" />
    </div>
  );
}

/** Panel card on the device-body frame; the list stays opaque, sidebar and
    reader are glass (message bodies pop as opaque cards on the material). */
const PANEL_FRAME = "overflow-hidden rounded-[8px] border border-(--te-border)";
const PANEL_CARD = `${PANEL_FRAME} bg-(--te-card)`;
const PANEL_CARD_GLASS = `${PANEL_FRAME} bg-(--te-card-glass)`;

export function HomeView() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // Account that owns the currently-open message (differs per row in combined views).
  const [readerAccountId, setReaderAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  // mailto: target from the OS (OtterMail as default mail app). The seq keys
  // NewMessageView so a link arriving while the composer is open re-seeds it.
  const [mailtoPrefill, setMailtoPrefill] = useState<MailtoTarget | null>(null);
  const [mailtoSeq, setMailtoSeq] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const credentialsQuery = useCredentials();
  const accountsQuery = useAccounts();
  const addAccount = useAddAccount();
  const { views } = useMailViews();

  const accounts = accountsQuery.data ?? [];
  const credentials = credentialsQuery.data;
  const accountIds = accounts.map((a) => a.id);
  const firstRealAccountId = accounts[0]?.id ?? null;

  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const globalSync = useGlobalSyncStatus(accountIds);

  const sidebarPane = useStoredWidth("gmail:pane:sidebar", 230, 180, 320);
  const listPane = useStoredWidth("gmail:pane:list", 400, 300, 640);
  const chatPane = useStoredWidth("gmail:pane:chat", 340, 280, 560, -1);
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("gmail:chat-open") === "1");
  // Rows multi-selected in the list, surfaced to the chat panel's context chip.
  const [chatSelection, setChatSelection] = useState<GmailMessageSummary[]>([]);
  const toggleChat = () => {
    setChatOpen((open) => {
      localStorage.setItem("gmail:chat-open", open ? "0" : "1");
      return !open;
    });
  };
  const openChat = () => {
    localStorage.setItem("gmail:chat-open", "1");
    setChatOpen(true);
  };

  // MessageList fills this each render; reader archive/trash advance through it.
  const advanceRef = useRef<(fromMessageId: string) => boolean>(() => false);
  const handleReaderAdvance = () => {
    if (!selectedMessageId || !advanceRef.current(selectedMessageId)) {
      setSelectedMessageId(null);
      setReaderAccountId(null);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // ⌘I toggles the Hermes chat panel — but only outside a text field, so
      // it keeps meaning italic in the composer/rich-text editor.
      if (e.key === "i" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (isTypingTarget(e)) return;
        e.preventDefault();
        setChatOpen((open) => {
          localStorage.setItem("gmail:chat-open", open ? "0" : "1");
          return !open;
        });
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // ⌘F and "/" focus the top-bar search field.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // ⌘1 = Combined mailbox, ⌘2…⌘9 = accounts in rail order. The ref is
  // populated below once handleSelectAccount exists.
  const accountSwitchRef = useRef<{ ids: string[]; select: (id: string) => void }>({
    ids: [],
    select: () => {},
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const digit = Number(e.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const { ids, select } = accountSwitchRef.current;
      if (ids.length === 0) return;
      e.preventDefault();
      if (digit === 1) {
        select(ids.length > 1 ? COMBINED_ACCOUNT_ID : ids[0]);
      } else {
        const target = ids[digit - 2];
        if (target) select(target);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const undoModifyMessage = useModifyMessage();
  const undoModifyThread = useModifyThread();
  const undoUntrashThread = useUntrashThread();
  const undoUntrashMessage = useUntrashMessage();
  const undoRunner = useRef<(action: UndoAction) => void>(() => {});
  undoRunner.current = (action) => {
    console.log("[HomeView:undo]", { kind: action.kind });
    const done = () => toast.success("Undone");
    const fail = () => toast.error("Could not undo");
    switch (action.kind) {
      case "modifyMessage":
        void undoModifyMessage.mutateAsync(action.params).then(done, fail);
        break;
      case "modifyThread":
        void undoModifyThread.mutateAsync(action.params).then(done, fail);
        break;
      case "untrashThread":
        void undoUntrashThread.mutateAsync(action.params).then(done, fail);
        break;
      case "untrashMessage":
        void undoUntrashMessage.mutateAsync(action.params).then(done, fail);
        break;
    }
  };

  // Gmail-style global shortcuts: c compose, u back to list, ? help, z undo,
  // and "g then i/t/s/d" go-to combos. Handlers read the latest state via a
  // ref so the listener mounts once.
  const shortcutCtx = useRef({ isCombined: false });
  shortcutCtx.current = { isCombined };
  const pendingG = useRef(0);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      const { isCombined: combined } = shortcutCtx.current;

      if (e.key === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (Date.now() - pendingG.current < 1500) {
        pendingG.current = 0;
        const go = (labelId: string) => {
          e.preventDefault();
          setSelectedLabelId(labelId);
          setSelectedMessageId(null);
          setReaderAccountId(null);
          setSearchQuery("");
        };
        if (e.key === "i") return go(combined ? INBOX_VIEW_ID : "INBOX");
        if (e.key === "t") return go(combined ? SENT_VIEW_ID : "SENT");
        if (e.key === "s") return go(combined ? STARRED_VIEW_ID : "STARRED");
        if (e.key === "d") return go(combined ? DRAFTS_VIEW_ID : "DRAFT");
        return;
      }

      if (e.key === "c") {
        e.preventDefault();
        setComposeOpen(true);
      } else if (e.key === "u" || e.key === "Escape") {
        e.preventDefault();
        setSelectedMessageId(null);
        setReaderAccountId(null);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.key === "z") {
        const action = takeUndo();
        if (action) {
          e.preventDefault();
          undoRunner.current(action);
        }
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // Once accounts are known, restore the last location or apply the default
  // (Combined when 2+ accounts, else the first account).
  useEffect(() => {
    if (initialized || accountsQuery.isLoading || accounts.length === 0) return;
    const canCombined = accounts.length > 1;
    const saved = loadLastLocation();
    let acct: string | null = null;
    let label = "INBOX";
    if (saved) {
      if (saved.accountId === COMBINED_ACCOUNT_ID && canCombined) {
        acct = COMBINED_ACCOUNT_ID;
        label = saved.labelId;
      } else if (accounts.some((a) => a.id === saved.accountId)) {
        acct = saved.accountId;
        label = saved.labelId;
      }
    }
    if (!acct) {
      if (canCombined) {
        acct = COMBINED_ACCOUNT_ID;
        label = INBOX_VIEW_ID;
      } else {
        acct = firstRealAccountId;
        label = "INBOX";
      }
    }
    setSelectedAccountId(acct);
    setSelectedLabelId(label);
    setInitialized(true);
  }, [initialized, accountsQuery.isLoading, accounts, firstRealAccountId]);

  // Persist where the user is so we can reopen here next launch.
  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    saveLastLocation({ accountId: selectedAccountId, labelId: selectedLabelId });
  }, [initialized, selectedAccountId, selectedLabelId]);

  // ── Back/forward navigation history (top bar) ────────────────────────────
  const [nav, setNav] = useState<{ stack: NavLoc[]; idx: number }>({ stack: [], idx: -1 });
  const navigatingRef = useRef(false);
  useEffect(() => {
    if (!initialized) return;
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }
    const loc: NavLoc = {
      accountId: selectedAccountId,
      labelId: selectedLabelId,
      messageId: selectedMessageId,
      readerAccountId,
    };
    setNav((h) => {
      const cur = h.stack[h.idx];
      if (
        cur &&
        cur.accountId === loc.accountId &&
        cur.labelId === loc.labelId &&
        cur.messageId === loc.messageId
      ) {
        return h;
      }
      const stack = [...h.stack.slice(Math.max(0, h.idx - 98), h.idx + 1), loc];
      return { stack, idx: stack.length - 1 };
    });
  }, [initialized, selectedAccountId, selectedLabelId, selectedMessageId, readerAccountId]);

  const applyNavLoc = (loc: NavLoc) => {
    navigatingRef.current = true;
    setSelectedAccountId(loc.accountId);
    setSelectedLabelId(loc.labelId);
    setSelectedMessageId(loc.messageId);
    setReaderAccountId(loc.readerAccountId);
    setSearchQuery("");
  };
  const goBack = () => {
    if (nav.idx <= 0) return;
    console.log("[HomeView:navBack]");
    applyNavLoc(nav.stack[nav.idx - 1]);
    setNav({ ...nav, idx: nav.idx - 1 });
  };
  const goForward = () => {
    if (nav.idx >= nav.stack.length - 1) return;
    console.log("[HomeView:navForward]");
    applyNavLoc(nav.stack[nav.idx + 1]);
    setNav({ ...nav, idx: nav.idx + 1 });
  };

  // ⌘[ / ⌘] and the mouse back/forward buttons drive the same history as the
  // header arrows. Latest closures via ref so the listeners mount once.
  const navActionsRef = useRef({ back: goBack, forward: goForward });
  navActionsRef.current = { back: goBack, forward: goForward };
  useEffect(() => {
    // The menu accelerators (main/index.ts "Go") broadcast these; a DOM
    // keydown never arrives for ⌘[/⌘] because the webview consumes it.
    const unsubBack = window.glazeAPI.glaze.ipc.onNotification("nav:back", () =>
      navActionsRef.current.back(),
    );
    const unsubForward = window.glazeAPI.glaze.ipc.onNotification("nav:forward", () =>
      navActionsRef.current.forward(),
    );
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navActionsRef.current.back();
      } else if (e.button === 4) {
        e.preventDefault();
        navActionsRef.current.forward();
      }
    };
    window.addEventListener("mouseup", mouse);
    return () => {
      unsubBack();
      unsubForward();
      window.removeEventListener("mouseup", mouse);
    };
  }, []);

  // mailto: links (default mail app): pull the pending target on mount (cold
  // start) and whenever the backend broadcasts one, then open the composer
  // prefilled.
  useEffect(() => {
    const pull = async () => {
      const target = await gmailApi.takePendingMailto();
      if (!target) return;
      console.log("[HomeView:mailto]", { to: target.to });
      setMailtoPrefill(target);
      setMailtoSeq((n) => n + 1);
      setComposeOpen(true);
    };
    void pull();
    const unsub = window.glazeAPI.glaze.ipc.onNotification("compose:mailto", () => void pull());
    return unsub;
  }, []);

  const effectiveAccountId = isCombined
    ? COMBINED_ACCOUNT_ID
    : selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : firstRealAccountId;

  // If the selected view disappears (deleted, or it has no rules for the
  // active account), fall back to Inbox.
  useEffect(() => {
    if (isCombined) {
      if (!views.some((v) => v.id === selectedLabelId)) {
        setSelectedLabelId(INBOX_VIEW_ID);
      }
      return;
    }
    const view = views.find((v) => v.id === selectedLabelId);
    if (!view) return; // plain label
    if (view.mailbox !== effectiveAccountId) {
      setSelectedLabelId("INBOX");
    }
  }, [isCombined, views, selectedLabelId, effectiveAccountId]);

  // Local-first: keep the on-disk cache synced in the background. Combined mode
  // refreshes all accounts via its own list handler (sentinel isn't a real account).
  useAccountSync(isCombined ? null : effectiveAccountId);

  // Per-account branding: selections, badges, the compose button and
  // the SDK accent all take the active account's color (Combined keeps the
  // neutral defaults). Set on the document root so portaled dialogs/menus
  // rebrand too; inline properties win over the injected theme rule.
  const brandAccount = isCombined
    ? null
    : (accounts.find((a) => a.id === effectiveAccountId) ?? null);
  const brand = brandAccount ? getAccountColor(brandAccount) : null;
  useEffect(() => {
    const root = document.documentElement.style;
    const props = [
      "--accent",
      "--accent-contrast",
      "--te-sel",
      "--te-sel-fg",
      "--te-selected",
      "--te-selected-fg",
      "--te-badge-bg",
      "--te-badge-fg",
      "--te-blue",
    ];
    if (!brand) {
      for (const p of props) root.removeProperty(p);
      return;
    }
    const contrast = getAccountContrastColor(brand);
    root.setProperty("--accent", brand);
    root.setProperty("--accent-contrast", contrast);
    root.setProperty("--te-sel", brand);
    root.setProperty("--te-sel-fg", contrast);
    root.setProperty("--te-selected", brand);
    root.setProperty("--te-selected-fg", contrast);
    root.setProperty("--te-badge-bg", brand);
    root.setProperty("--te-badge-fg", contrast);
    root.setProperty("--te-blue", brand);
  }, [brand]);

  // Resolve the selected view to concrete per-account rules.
  const combined = (() => {
    if (isCombined) {
      const view = views.find((v) => v.id === selectedLabelId) ?? views[0];
      return {
        viewId: view?.id ?? INBOX_VIEW_ID,
        name: view?.name ?? "Inbox",
        rules: view ? resolveRules(view, accounts) : [],
      };
    }
    // Account mailboxes own their views outright — rules reference only the
    // owning account, but prune defensively anyway.
    const view = views.find((v) => v.id === selectedLabelId);
    if (!view || !effectiveAccountId || view.mailbox !== effectiveAccountId) return null;
    const rules = resolveRules(view, accounts).filter((r) => r.accountId === effectiveAccountId);
    if (rules.length === 0) return null;
    return { viewId: `${effectiveAccountId}:${view.id}`, name: view.name, rules };
  })();

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    setComposeOpen(false);
    setSelectedAccountId(accountId);
    setSelectedLabelId(accountId === COMBINED_ACCOUNT_ID ? INBOX_VIEW_ID : "INBOX");
    setSelectedMessageId(null);
    setReaderAccountId(null);
    setSearchQuery("");
  };
  accountSwitchRef.current = { ids: accountIds, select: handleSelectAccount };

  const handleSelectLabel = (labelId: string) => {
    console.log("[HomeView:selectLabel]", { labelId });
    setComposeOpen(false);
    setSelectedLabelId(labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
    setSearchQuery("");
  };

  const handleSelectMessage = (messageId: string, accountId: string) => {
    console.log("[HomeView:selectMessage]", { messageId, accountId });
    setComposeOpen(false);
    setSelectedMessageId(messageId);
    setReaderAccountId(accountId);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };

  // Palette mail result: jump to the owning account (Combined stays put) and open.
  const handlePaletteOpenMessage = (message: GmailMessageSummary) => {
    console.log("[HomeView:paletteOpenMessage]", { messageId: message.id, accountId: message.accountId });
    const owner = message.accountId ?? firstRealAccountId;
    if (!owner) return;
    if (!isCombined && owner !== effectiveAccountId) {
      setSelectedAccountId(owner);
      setSelectedLabelId("INBOX");
      setSearchQuery("");
    }
    setSelectedMessageId(message.id);
    setReaderAccountId(owner);
  };

  const handlePaletteGoToView = (viewId: string) => {
    console.log("[HomeView:paletteGoToView]", { viewId });
    setSelectedAccountId(COMBINED_ACCOUNT_ID);
    setSelectedLabelId(viewId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
    setSearchQuery("");
  };

  const handleOpenSettings = () => {
    console.log("[HomeView:openSettings]");
    void window.glazeAPI.glaze.ipc.invoke("window:openSettings");
  };

  const handleAddAccount = async () => {
    console.log("[HomeView:addAccount]");
    try {
      const account = await addAccount.mutateAsync();
      setSelectedAccountId(account.id);
      setSelectedLabelId("INBOX");
    } catch {
      // error surfaced by mutation
    }
  };

  // (a) Loading credentials
  if (credentialsQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-(--te-card)">
        <div className="size-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // (a) No credentials configured
  if (!credentials?.hasCredentials) {
    return (
      <div className="h-full flex items-center justify-center bg-(--te-card)">
        <EmptyState
          title="Set up Gmail"
          description="Configure your Google OAuth credentials in Settings to connect Gmail accounts."
          actions={
            <Button variant="accent" onClick={handleOpenSettings}>
              Open Settings
            </Button>
          }
        />
      </div>
    );
  }

  // (b) Credentials set but no accounts connected
  if (!accountsQuery.isLoading && accounts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-(--te-card)">
        <EmptyState
          title="Connect your Gmail account"
          description="Sign in with Google to start reading your emails."
          actions={
            <Button
              variant="accent"
              onClick={() => void handleAddAccount()}
              disabled={addAccount.isPending}
            >
              {addAccount.isPending ? "Connecting..." : "Add Gmail account"}
            </Button>
          }
        />
      </div>
    );
  }

  const composeAccountId = isCombined ? firstRealAccountId : effectiveAccountId;
  const readerAccount = readerAccountId ?? (isCombined ? firstRealAccountId : effectiveAccountId);
  const hasListTarget = isCombined || effectiveAccountId != null;

  // (c) Device frame: top bar, workspace rail, faceplate content card.
  return (
    <>
      <div className="flex h-full flex-col bg-(--te-frame) text-(--te-text)">
        <TopBar
          canGoBack={nav.idx > 0}
          canGoForward={nav.idx < nav.stack.length - 1}
          onBack={goBack}
          onForward={goForward}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          searchRef={searchRef}
          syncing={globalSync.syncing}
          syncLabel={globalSync.label}
          accounts={accounts}
          selectedAccountId={effectiveAccountId}
          onSelectAccount={handleSelectAccount}
          onAddAccount={() => void handleAddAccount()}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          chatOpen={chatOpen}
          onToggleChat={toggleChat}
        />
        {/* Outer bottom corners run concentric with the 26px window radius (4px margin). */}
        <div className="flex min-h-0 flex-1 px-1 pb-1">
          <div
            style={{ width: sidebarPane.width }}
            className={`${PANEL_CARD_GLASS} shrink-0 rounded-bl-[22px]`}
          >
            <AccountsSidebar
              selectedAccountId={effectiveAccountId}
              onSelectAccount={handleSelectAccount}
              selectedLabelId={selectedLabelId}
              onSelectLabel={handleSelectLabel}
              views={views}
              onCompose={() => setComposeOpen(true)}
            />
          </div>
          <PaneResizer onPointerDown={sidebarPane.start} />
          {hasListTarget ? (
            <>
              <div style={{ width: listPane.width }} className={`${PANEL_CARD} shrink-0`}>
                <MessageList
                  accountId={(isCombined ? firstRealAccountId : effectiveAccountId) ?? ""}
                  labelId={selectedLabelId}
                  combined={combined}
                  accountIds={accountIds}
                  accounts={accounts}
                  selectedMessageId={selectedMessageId}
                  onSelectMessage={handleSelectMessage}
                  onDeselect={() => {
                    setSelectedMessageId(null);
                    setReaderAccountId(null);
                  }}
                  advanceRef={advanceRef}
                  onSelectionChange={setChatSelection}
                  onOpenChat={openChat}
                  searchQuery={searchQuery}
                />
              </div>
              <PaneResizer onPointerDown={listPane.start} />
            </>
          ) : null}
          <div
            className={`${PANEL_CARD_GLASS} min-w-0 flex-1 ${chatOpen ? "" : "rounded-br-[22px]"}`}
          >
            {composeOpen && composeAccountId ? (
              <NewMessageView
                key={mailtoSeq}
                accounts={accounts}
                defaultAccountId={composeAccountId}
                onClose={() => {
                  setComposeOpen(false);
                  setMailtoPrefill(null);
                }}
                prefill={mailtoPrefill ?? undefined}
              />
            ) : readerAccount ? (
              <MessageReader
                accountId={readerAccount}
                messageId={selectedMessageId}
                onDeselect={() => {
                  setSelectedMessageId(null);
                  setReaderAccountId(null);
                }}
                onAdvance={handleReaderAdvance}
                onOpenChat={openChat}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title="No account selected"
                  description="Select an account from the top bar."
                />
              </div>
            )}
          </div>
          {chatOpen ? (
            <>
              <PaneResizer onPointerDown={chatPane.start} />
              <div
                style={{ width: chatPane.width }}
                className={`${PANEL_CARD_GLASS} shrink-0 rounded-br-[22px]`}
              >
                <HermesChatPanel
                  accountId={selectedMessageId ? readerAccount : null}
                  messageId={selectedMessageId}
                  selectedRows={chatSelection}
                  onClose={toggleChat}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {accounts.length > 0 ? (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          accounts={accounts}
          views={views}
          onOpenMessage={handlePaletteOpenMessage}
          onGoToView={handlePaletteGoToView}
          onCompose={() => setComposeOpen(true)}
        />
      ) : null}
    </>
  );
}
