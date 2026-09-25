import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EmptyState, Button, toast } from "@glaze/core/components";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { NewMessageView } from "./gmail/new-message-view";
import { CommandPalette } from "./gmail/command-palette";
import { AssistantChatPanel } from "./gmail/assistant-chat";
import { SEARCH_MAILBOX } from "./gmail/gmail-query";
import { searchTabId, searchTitle, type SearchTab } from "./gmail/search-tabs";
import {
  PanelControl,
  SidebarControl,
  TitleControls,
  TitleTrailing,
  TitlebarInset,
  WindowTitle,
} from "./gmail/top-bar";
import { SettingsPage, type SettingsRoute } from "./settings/settings-page";
import { SettingsNav, settingsSectionLabel } from "./settings/settings-nav";
import { isTypingTarget } from "./gmail/keyboard";
import { cn } from "./gmail/ui";
import { usePanelAnimationSettings, usePanelPresence } from "./panel-animations";
import {
  useCommandHandlers,
  useKeybindingContext,
  useKeybindingDispatcher,
} from "./keybindings/dispatch";
import { MAILBOX_JUMP_COMMANDS } from "./keybindings/commands";
import { onKeybindingsReload } from "./keybindings/store";
import {
  useAccounts,
  useAddAccount,
  useAccountSync,
  useGlobalSyncStatus,
  useGmailWriteFailureToasts,
  useExternalMailChanges,
  useModifyMessage,
  useModifyThread,
  useUntrashThread,
  useUntrashMessage,
} from "./gmail/hooks";
import { beginUndoGroup, takeUndo, type UndoAction } from "./gmail/undo";
import { getAccountColor, getAccountContrastColor } from "./gmail/account-style";
import { gmailApi, type MailtoTarget } from "./gmail/api";
import type { QuoteContext } from "./gmail/chat-context";
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
  ALL_MAIL_VIEW_ID,
} from "./gmail/custom-views";
import { ALL_MAIL_LABEL_ID } from "./gmail/label-names";

/** Narrowest the reader gets when the chat panel is dragged wider. */
const READER_MIN_WIDTH = 360;

/** A place the user was at, for the top-bar back/forward buttons. */
type NavLoc = {
  accountId: string | null;
  labelId: string;
  messageId: string | null;
  readerAccountId: string | null;
};

/**
 * Drag-resizable pane width persisted to localStorage. `room` (when given)
 * caps the width at drag start so neighbouring panes keep their minimum.
 */
function useStoredWidth(
  key: string,
  def: number,
  min: number,
  max: number,
  dir: 1 | -1 = 1,
  room?: () => number,
) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : def;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  // The pane element itself, resized imperatively during a drag.
  const paneRef = useRef<HTMLDivElement>(null);
  // The animated frame around a collapsible pane: follows the drag with its
  // open/close transition switched off.
  const frameRef = useRef<HTMLDivElement>(null);

  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const cap = Math.max(min, Math.min(max, room ? room() : max));
    let latest = startW;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (paneRef.current) paneRef.current.style.width = `${latest}px`;
      if (frameRef.current) frameRef.current.style.width = `${latest}px`;
    };
    const move = (ev: PointerEvent) => {
      // dir -1: right-side panes grow when the handle drags left.
      latest = Math.min(cap, Math.max(min, startW + dir * (ev.clientX - startX)));
      // Drive the drag through the DOM only — calling setWidth on every
      // pointermove re-renders the whole HomeView tree (message list, reader,
      // chat) each frame, which is what made resizing slow and shaky. Batch the
      // style write to one per frame and commit to React state once, on release.
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (raf) cancelAnimationFrame(raf);
      apply();
      if (frameRef.current) frameRef.current.style.transitionProperty = "";
      widthRef.current = latest;
      setWidth(latest);
      localStorage.setItem(key, String(latest));
    };
    if (frameRef.current) frameRef.current.style.transitionProperty = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { width, start, paneRef, frameRef };
}

function PaneResizer({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent) => void }) {
  // Zero-width in the layout so panes meet on their own single hairline; the
  // grab area is an invisible strip centered on that line (no-drag, so it
  // resizes instead of moving the window inside the title band).
  return (
    <div className="relative z-20 w-0 shrink-0" aria-hidden>
      <div
        onPointerDown={onPointerDown}
        className="no-drag group absolute inset-y-0 -left-[3px] flex w-1.5 cursor-col-resize justify-center"
      >
        <div className="w-px transition-colors group-hover:bg-input" />
      </div>
    </div>
  );
}

/** Flush panes separated by hairlines: grained sidebar, canvas list and
    reader, card-toned chat column. */
const PANE = "min-h-0 overflow-hidden";
const PANE_SIDEBAR = `${PANE} surface-grain border-r border-sidebar-line bg-sidebar-surface text-sidebar-foreground`;
const PANE_LIST = `${PANE} border-r border-border bg-canvas`;
const PANE_MAIN = `${PANE} bg-canvas`;
const PANE_CHAT = `${PANE} border-l border-border bg-card`;
/** Clips a collapsible pane while its width animates open or closed (Otter
    Code's panel animations); the pane keeps its width so nothing reflows. */
const PANE_FRAME =
  "flex min-h-0 shrink-0 overflow-hidden [[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out";

export function HomeView() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // Account that owns the currently-open message (differs per row in combined views).
  const [readerAccountId, setReaderAccountId] = useState<string | null>(null);
  // Open searches, each a sidebar row: the top Search row (all mail) and one
  // per view it was started from (⌘F there). They keep their query and any
  // unrun text while you visit other mailboxes; × or Escape closes them.
  const [searchTabs, setSearchTabs] = useState<SearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // mailto: target from the OS (OtterMail as default mail app). The seq keys
  // NewMessageView so a link arriving while the composer is open re-seeds it.
  const [mailtoPrefill, setMailtoPrefill] = useState<MailtoTarget | null>(null);
  const [mailtoSeq, setMailtoSeq] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // In-app settings page; null = mail. Opened from the sidebar footer, ⌘,
  // (menu accelerator → backend broadcast), or any window's deep link.
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute | null>(null);
  const settingsRouteRef = useRef(settingsRoute);
  settingsRouteRef.current = settingsRoute;
  useEffect(() => {
    const pull = async () => {
      try {
        const target = await gmailApi.getSettingsTarget();
        if (!target) return;
        console.log("[HomeView:openSettings]", { pane: target.pane });
        setSettingsRoute({
          pane: target.pane,
          viewId: target.viewId ?? null,
          mailbox: target.mailbox ?? null,
        });
      } catch (error) {
        console.log("[HomeView:getSettingsTarget] failed", { error: String(error) });
      }
    };
    void pull();
    return window.glazeAPI.glaze.ipc.onNotification("settings:open", () => void pull());
  }, []);

  // ⌘W (File ▸ Close): the assistant's active chat tab closes first; with no
  // tab left to close, the window does (Otter Code).
  const closeChatTabRef = useRef<(() => boolean) | null>(null);
  useEffect(
    () =>
      window.glazeAPI.glaze.ipc.onNotification("window:closeRequest", () => {
        if (closeChatTabRef.current?.()) return;
        void gmailApi.closeMainWindow();
      }),
    [],
  );
  // Escape leaves settings (blurring a focused field first, like a dialog).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !settingsRouteRef.current) return;
      if (isTypingTarget(e)) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      e.preventDefault();
      setSettingsRoute(null);
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);
  const [initialized, setInitialized] = useState(false);

  const accountsQuery = useAccounts();
  const addAccount = useAddAccount();
  const { views } = useMailViews();

  const accounts = accountsQuery.data ?? [];
  const accountIds = accounts.map((a) => a.id);
  const firstRealAccountId = accounts[0]?.id ?? null;

  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const globalSync = useGlobalSyncStatus(accountIds);
  useGmailWriteFailureToasts();
  useExternalMailChanges();

  const sidebarPane = useStoredWidth("gmail:pane:sidebar", 256, 224, 400);
  const listPane = useStoredWidth("gmail:pane:list", 400, 300, 640);
  // The chat can grow wide, as long as the reader keeps READER_MIN_WIDTH.
  const chatPane = useStoredWidth(
    "gmail:pane:chat",
    340,
    280,
    900,
    -1,
    () =>
      window.innerWidth - (sidebarOpen ? sidebarPane.width : 0) - listPane.width - READER_MIN_WIDTH,
  );
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("gmail:chat-open") === "1");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("gmail:sidebar-open") !== "0",
  );
  // Entering or leaving Settings swaps panes in place rather than animating them.
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings(settingsRoute ? "settings" : "mail");
  const chatVisible = chatOpen && !settingsRoute;
  const sidebarPresent = usePanelPresence(
    sidebarOpen,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const chatPresent = usePanelPresence(
    chatVisible,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem("gmail:sidebar-open", open ? "0" : "1");
      return !open;
    });
  };
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
  // A highlighted excerpt handed from the reader to the chat panel (one-shot).
  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);

  // MessageList fills this each render; reader archive/trash advance through it.
  const advanceRef = useRef<(fromMessageId: string) => boolean>(() => false);
  const handleReaderAdvance = () => {
    if (!selectedMessageId || !advanceRef.current(selectedMessageId)) {
      setSelectedMessageId(null);
      setReaderAccountId(null);
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘1 = Combined mailbox, ⌘2…⌘9 = accounts in rail order. The ref is
  // populated below once handleSelectAccount exists.
  const accountSwitchRef = useRef<{ ids: string[]; select: (id: string) => void }>({
    ids: [],
    select: () => {},
  });

  const undoModifyMessage = useModifyMessage();
  const undoModifyThread = useModifyThread();
  const undoUntrashThread = useUntrashThread();
  const undoUntrashMessage = useUntrashMessage();
  const undoRunner = useRef<(action: UndoAction) => void>(() => {});
  const runUndo = (action: UndoAction): Promise<unknown> => {
    switch (action.kind) {
      case "modifyMessage":
        return undoModifyMessage.mutateAsync(action.params);
      case "modifyThread":
        return undoModifyThread.mutateAsync(action.params);
      case "untrashThread":
        return undoUntrashThread.mutateAsync(action.params);
      case "untrashMessage":
        return undoUntrashMessage.mutateAsync(action.params);
      case "batch":
        // Their redo registrations regroup, so z again redoes the whole batch.
        beginUndoGroup(action.actions.length);
        return Promise.all(action.actions.map(runUndo));
    }
  };
  undoRunner.current = (action) => {
    console.log("[HomeView:undo]", {
      kind: action.kind,
      count: action.kind === "batch" ? action.actions.length : 1,
    });
    runUndo(action).then(
      () => toast.success("Undone"),
      () => toast.error("Could not undo"),
    );
  };

  // Keyboard commands (Settings › Keybindings; defaults in keybindings/commands.ts).
  useKeybindingDispatcher();
  // Hand edits to keybindings.json apply live; say so (and flag bad entries).
  useEffect(
    () =>
      onKeybindingsReload(({ initial, external, issueCount }) => {
        if (!external) return;
        if (issueCount > 0)
          toast.error(
            `${issueCount} keybinding${issueCount === 1 ? "" : "s"} in keybindings.json couldn't be used`,
          );
        else if (!initial) toast.success("Keybindings updated");
      }),
    [],
  );
  useKeybindingContext("settingsOpen", settingsRoute !== null);
  useKeybindingContext("messageOpen", selectedMessageId !== null);
  const goTo = (combinedViewId: string, labelId: string) => {
    setSelectedLabelId(isCombined ? combinedViewId : labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };
  const jumpToMailbox = (digit: number) => {
    const { ids, select } = accountSwitchRef.current;
    if (ids.length === 0) return false;
    // ⌘1 = Combined (or the only account), ⌘2… = accounts in sidebar order.
    if (digit === 1) select(ids.length > 1 ? COMBINED_ACCOUNT_ID : ids[0]);
    else if (ids[digit - 2]) select(ids[digit - 2]);
    else return false;
  };
  useCommandHandlers({
    "commandPalette.toggle": () => setPaletteOpen((o) => !o),
    "sidebar.toggle": () => toggleSidebar(),
    "assistant.toggle": () => toggleChat(),
    "search.focus": () => searchFromView(),
    "compose.new": () => setComposeOpen(true),
    "keybindings.show": () =>
      setSettingsRoute({ pane: "keybindings", viewId: null, mailbox: null }),
    "mail.undo": () => {
      const action = takeUndo();
      if (!action) return false;
      undoRunner.current(action);
    },
    "go.inbox": () => goTo(INBOX_VIEW_ID, "INBOX"),
    "go.sent": () => goTo(SENT_VIEW_ID, "SENT"),
    "go.starred": () => goTo(STARRED_VIEW_ID, "STARRED"),
    "go.drafts": () => goTo(DRAFTS_VIEW_ID, "DRAFT"),
    "go.allMail": () => goTo(ALL_MAIL_VIEW_ID, ALL_MAIL_LABEL_ID),
    "message.close": () => {
      setSelectedMessageId(null);
      setReaderAccountId(null);
    },
    ...Object.fromEntries(
      MAILBOX_JUMP_COMMANDS.map((command, i) => [command, () => jumpToMailbox(i + 1)]),
    ),
  });

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
    // The Search mailbox isn't a place to reopen into.
    if (selectedLabelId === SEARCH_MAILBOX) return;
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

  // A conversation clicked in the menu-bar popover opens here, in the reader.
  const openFromTrayRef = useRef<(accountId: string, messageId: string) => void>(() => {});
  useEffect(() => {
    const pull = async () => {
      const target = await gmailApi.takePendingOpenMessage().catch(() => null);
      if (!target) return;
      console.log("[HomeView:openFromTray]", { messageId: target.messageId });
      openFromTrayRef.current(target.accountId, target.messageId);
    };
    void pull();
    return window.glazeAPI.glaze.ipc.onNotification("mail:open", () => void pull());
  }, []);

  const effectiveAccountId = isCombined
    ? COMBINED_ACCOUNT_ID
    : selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : firstRealAccountId;

  // If the selected view disappears (deleted, or it has no rules for the
  // active account), fall back to Inbox.
  useEffect(() => {
    if (selectedLabelId === SEARCH_MAILBOX) return;
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

  // Per-account branding: the primary (send, unread dot, focus ring) and the
  // SDK accent take the active account's color; selection surfaces stay
  // neutral (Combined keeps the default blue). Set on the document root so
  // portaled dialogs/menus rebrand too; inline properties win over the
  // injected theme rule.
  const brandAccount = isCombined
    ? null
    : (accounts.find((a) => a.id === effectiveAccountId) ?? null);
  const brand = brandAccount ? getAccountColor(brandAccount) : null;
  useEffect(() => {
    const root = document.documentElement.style;
    const props = ["--accent", "--accent-contrast", "--primary", "--primary-foreground", "--ring"];
    if (!brand) {
      for (const p of props) root.removeProperty(p);
      return;
    }
    const contrast = getAccountContrastColor(brand);
    root.setProperty("--accent", brand);
    root.setProperty("--accent-contrast", contrast);
    root.setProperty("--primary", brand);
    root.setProperty("--primary-foreground", contrast);
    root.setProperty("--ring", brand);
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
  };
  accountSwitchRef.current = { ids: accountIds, select: handleSelectAccount };

  const handleSelectLabel = (labelId: string) => {
    console.log("[HomeView:selectLabel]", { labelId });
    setComposeOpen(false);
    setSelectedLabelId(labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };

  const handleSelectMessage = (messageId: string, accountId: string) => {
    console.log("[HomeView:selectMessage]", { messageId, accountId });
    setComposeOpen(false);
    setSelectedMessageId(messageId);
    setReaderAccountId(accountId);
  };

  // ── Search mailbox ───────────────────────────────────────────────────────
  // Search is a mailbox like Inbox: selecting a search row (the top Search
  // row, or one under the view it was started from) shows Gmail's search in
  // the list pane. Escape clears it, then closes it back to where you were.
  const searchActive = selectedLabelId === SEARCH_MAILBOX;
  const searchReturnRef = useRef<string>("INBOX");
  const searchMailbox = selectedAccountId ?? "";
  const topSearchId = searchTabId(searchMailbox, null);
  const activeSearch = searchActive
    ? (searchTabs.find((t) => t.id === activeSearchId) ?? null)
    : null;
  const patchSearch = (id: string, patch: Partial<SearchTab>) =>
    setSearchTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  // Where a new search looks by default: the mailbox you started it from.
  const defaultScope = (): string[] =>
    isCombined || !effectiveAccountId
      ? combined && selectedLabelId !== SEARCH_MAILBOX
        ? [...new Set(combined.rules.map((r) => r.accountId))]
        : accountIds
      : [effectiveAccountId];
  const focusSearchEnd = () =>
    setTimeout(() => {
      const input = searchRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  const showSearch = (id: string) => {
    if (!searchActive) searchReturnRef.current = selectedLabelId;
    setComposeOpen(false);
    setSettingsRoute(null);
    setSelectedLabelId(SEARCH_MAILBOX);
    setActiveSearchId(id);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };
  /** The top Search row (all mail), optionally running `q`. */
  const openSearch = (q?: string) => {
    console.log("[HomeView:openSearch]", { hasQuery: Boolean(q) });
    setSearchTabs((tabs) => {
      const existing = tabs.find((t) => t.id === topSearchId);
      if (existing)
        return q === undefined
          ? tabs
          : tabs.map((t) => (t.id === topSearchId ? { ...t, query: q, draft: q } : t));
      return [
        ...tabs,
        {
          id: topSearchId,
          mailbox: searchMailbox,
          parent: null,
          base: "",
          query: q ?? "",
          draft: q ?? "",
          scope: defaultScope(),
        },
      ];
    });
    showSearch(topSearchId);
    // Focus once the header has mounted (no query: ready to type).
    if (!q) focusSearchEnd();
  };
  // ⌘F / the list's search icon: the view's own search row, opened under it
  // with its operators prefilled (`in:inbox `) and the cursor after them.
  // Already in a search, it just focuses the bar.
  const viewQueryRef = useRef("");
  const searchFromView = () => {
    if (searchActive && !settingsRoute) {
      searchRef.current?.focus();
      return;
    }
    const base = viewQueryRef.current;
    if (!base) return openSearch();
    const id = searchTabId(searchMailbox, selectedLabelId);
    console.log("[HomeView:searchFromView]", { base });
    setSearchTabs((tabs) =>
      tabs.some((t) => t.id === id)
        ? tabs
        : [
            ...tabs,
            {
              id,
              mailbox: searchMailbox,
              parent: selectedLabelId,
              base,
              query: "",
              draft: `${base} `,
              scope: defaultScope(),
            },
          ],
    );
    showSearch(id);
    focusSearchEnd();
  };
  const runSearch = (q: string) => {
    const tab = activeSearch;
    if (!tab) return openSearch(q);
    // Dropping the view's operators makes it a search of all mail: it moves
    // up to the top Search row.
    if (tab.parent && !q.includes(tab.base)) {
      console.log("[HomeView:searchLeavesView]");
      setSearchTabs((tabs) => [
        ...tabs.filter((t) => t.id !== tab.id && t.id !== topSearchId),
        { ...tab, id: topSearchId, parent: null, base: "", query: q, draft: q },
      ]);
      setActiveSearchId(topSearchId);
      return;
    }
    patchSearch(tab.id, { query: q, draft: q });
  };
  const closeSearch = (id: string) => {
    const tab = searchTabs.find((t) => t.id === id);
    console.log("[HomeView:closeSearch]", { child: Boolean(tab?.parent) });
    setSearchTabs((tabs) => tabs.filter((t) => t.id !== id));
    if (searchActive && activeSearchId === id) {
      setSelectedLabelId(tab?.parent ?? searchReturnRef.current);
      setSelectedMessageId(null);
      setReaderAccountId(null);
    }
  };
  const handleSearchChange = (q: string) => openSearch(q);
  // Back/forward into a search that was since closed: the top Search row.
  useEffect(() => {
    if (searchActive && !activeSearch) openSearch();
  });

  // Palette mail result: jump to the owning account (Combined stays put) and open.
  const handlePaletteOpenMessage = (message: GmailMessageSummary) => {
    console.log("[HomeView:paletteOpenMessage]", {
      messageId: message.id,
      accountId: message.accountId,
    });
    const owner = message.accountId ?? firstRealAccountId;
    if (!owner) return;
    if (!isCombined && owner !== effectiveAccountId) {
      setSelectedAccountId(owner);
      setSelectedLabelId("INBOX");
    }
    setSelectedMessageId(message.id);
    setReaderAccountId(owner);
  };

  openFromTrayRef.current = (owner, messageId) => {
    setComposeOpen(false);
    setSettingsRoute(null);
    if (!isCombined && owner !== effectiveAccountId) {
      setSelectedAccountId(owner);
      setSelectedLabelId("INBOX");
    }
    setSelectedMessageId(messageId);
    setReaderAccountId(owner);
  };

  const handlePaletteGoToView = (viewId: string) => {
    console.log("[HomeView:paletteGoToView]", { viewId });
    setSelectedAccountId(COMBINED_ACCOUNT_ID);
    setSelectedLabelId(viewId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
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

  // No accounts connected
  if (!accountsQuery.isLoading && accounts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
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

  // Full-height columns: each pane owns its slice of the title band, so the
  // separators run from the very top of the window.
  // Manual refresh: spin from the click until every account's sync settles
  // (any phase — the passive indicator only shows long full/body syncs), and
  // for at least a beat so a fast incremental sync still reads as feedback.
  const [manualSyncing, setManualSyncing] = useState(false);
  const syncNow = () => {
    if (manualSyncing) return;
    console.log("[HomeView:syncNow]");
    setManualSyncing(true);
    const startedAt = Date.now();
    void (async () => {
      try {
        await Promise.all(accountIds.map((id) => gmailApi.syncAccount(id).catch(() => null)));
        for (let i = 0; i < 150; i++) {
          const statuses = await Promise.all(
            accountIds.map((id) => gmailApi.getSyncStatus(id).catch(() => null)),
          );
          if (!statuses.some((st) => st?.syncing)) break;
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        const remaining = 700 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        setManualSyncing(false);
      }
    })();
  };
  // With a conversation open, its header is the title band (subject, actions
  // and the panel toggle in one row) instead of an empty band above it.
  const readerOwnsBand =
    !settingsRoute && !(composeOpen && composeAccountId) && !!readerAccount && !!selectedMessageId;
  const titleTrailing = <TitleTrailing showPanelToggle={!chatOpen && !settingsRoute} />;
  // With the sidebar hidden and no list pane, this band is the leftmost one: it
  // needs the traffic-light clearance and the toggle to bring the sidebar (and
  // Settings' Back button) back.
  const mainIsLeftmost = !sidebarOpen && !(hasListTarget && !settingsRoute);
  const titleControls = (
    <TitleControls
      leading={
        <>
          {mainIsLeftmost ? <TitlebarInset /> : null}
          {settingsRoute ? (
            <nav aria-label="Settings" className="min-w-0">
              <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm">
                <li className="shrink-0 font-medium text-muted-foreground">Settings</li>
                <li aria-hidden="true" className="flex shrink-0 items-center text-icon-muted">
                  /
                </li>
                <li className="min-w-0 truncate font-medium text-foreground">
                  {settingsSectionLabel(settingsRoute.pane)}
                </li>
              </ol>
            </nav>
          ) : null}
        </>
      }
      syncing={globalSync.syncing}
      syncLabel={globalSync.label}
      // Room for the pinned panel toggle while the panel is closed; when
      // open, the panel's header keeps it. Settings has no panel.
      showPanelToggle={!chatOpen && !settingsRoute}
    />
  );
  return (
    <>
      <div
        className="flex h-full bg-canvas text-foreground"
        data-panel-animations={panelAnimationsActive ? "true" : "false"}
        style={{ "--panel-animation-duration": `${panelAnimationDurationMs}ms` } as CSSProperties}
      >
        <div className="contents">
          {sidebarPresent ? (
            <>
              <div
                ref={sidebarPane.frameRef}
                style={{ width: sidebarOpen ? sidebarPane.width : 0 }}
                className={cn(
                  PANE_FRAME,
                  // Anchored right, so the sidebar slides out to the left.
                  "justify-end",
                  sidebarOpen && "[[data-panel-animations=true]_&]:starting:w-0!",
                  !sidebarOpen && "pointer-events-none",
                )}
              >
                <div
                  ref={sidebarPane.paneRef}
                  style={{ width: sidebarPane.width }}
                  className={`${PANE_SIDEBAR} flex shrink-0 flex-col`}
                  data-app-sidebar=""
                >
                  {settingsRoute ? (
                    <>
                      <WindowTitle />
                      <SettingsNav
                        pane={settingsRoute.pane}
                        onSelect={(pane) => setSettingsRoute({ pane, viewId: null, mailbox: null })}
                        onBack={() => setSettingsRoute(null)}
                      />
                    </>
                  ) : (
                    <AccountsSidebar
                      onOpenSettings={() =>
                        setSettingsRoute({ pane: "general", viewId: null, mailbox: null })
                      }
                      onEditView={(viewId, mailbox) =>
                        setSettingsRoute({ pane: "views", viewId, mailbox })
                      }
                      onSync={syncNow}
                      syncing={globalSync.syncing || manualSyncing}
                      selectedAccountId={effectiveAccountId}
                      onSelectAccount={handleSelectAccount}
                      selectedLabelId={selectedLabelId}
                      onSelectLabel={handleSelectLabel}
                      views={views}
                      onCompose={() => setComposeOpen(true)}
                      searchSelected={activeSearch?.id === topSearchId}
                      searchPending={Boolean(
                        searchTabs.find((t) => t.id === topSearchId)?.draft.trim(),
                      )}
                      searches={searchTabs
                        .filter((t) => t.mailbox === searchMailbox && t.parent)
                        .map((t) => ({
                          id: t.id,
                          parent: t.parent!,
                          title: searchTitle(t),
                          selected: activeSearch?.id === t.id,
                        }))}
                      onSelectSearch={(id) => {
                        showSearch(id);
                        focusSearchEnd();
                      }}
                      onCloseSearch={closeSearch}
                      onOpenSearch={() => openSearch()}
                    />
                  )}
                </div>
              </div>
              {sidebarOpen ? <PaneResizer onPointerDown={sidebarPane.start} /> : null}
            </>
          ) : null}
          {hasListTarget && !settingsRoute ? (
            <>
              <div
                ref={listPane.paneRef}
                style={{ width: listPane.width }}
                className={`${PANE_LIST} shrink-0`}
              >
                <MessageList
                  headerLeading={sidebarOpen ? null : <TitlebarInset />}
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
                  onSearchView={searchFromView}
                  viewQueryRef={viewQueryRef}
                  search={
                    activeSearch
                      ? {
                          id: activeSearch.id,
                          query: activeSearch.query,
                          base: activeSearch.base,
                          accountIds: activeSearch.scope,
                          onSearch: runSearch,
                          onClear: () => {
                            const base = activeSearch.base ? `${activeSearch.base} ` : "";
                            patchSearch(activeSearch.id, { query: "", draft: base });
                            focusSearchEnd();
                          },
                          onExit: () => closeSearch(activeSearch.id),
                          onScope: (scope) => patchSearch(activeSearch.id, { scope }),
                          focusRef: searchRef,
                          draft: activeSearch.draft,
                          onDraftChange: (draft) => patchSearch(activeSearch.id, { draft }),
                          messageOpen: selectedMessageId !== null,
                        }
                      : undefined
                  }
                />
              </div>
              <PaneResizer onPointerDown={listPane.start} />
            </>
          ) : null}
          <div className={`${PANE_MAIN} flex min-w-0 flex-1 flex-col`}>
            {readerOwnsBand ? null : titleControls}
            <div className="flex min-h-0 flex-1 flex-col">
              {settingsRoute ? (
                <SettingsPage route={settingsRoute} onNavigate={setSettingsRoute} />
              ) : composeOpen && composeAccountId ? (
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
                  titleTrailing={titleTrailing}
                  accountId={readerAccount}
                  messageId={selectedMessageId}
                  onDeselect={() => {
                    setSelectedMessageId(null);
                    setReaderAccountId(null);
                  }}
                  onAdvance={handleReaderAdvance}
                  onOpenChat={openChat}
                  onQuote={(q) => {
                    // Only reflect selections while the panel is open, so normal
                    // reading/copying is never hijacked.
                    if (chatOpen) setPendingQuote(q);
                  }}
                  onComposeTo={(email) => {
                    setMailtoPrefill({ to: email, cc: "", subject: "", body: "" });
                    setMailtoSeq((n) => n + 1);
                    setComposeOpen(true);
                  }}
                  onSearchSender={(email) => handleSearchChange(`from:${email}`)}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    title="No account selected"
                    description="Select a mailbox from the sidebar."
                  />
                </div>
              )}
            </div>
          </div>
          {chatPresent ? (
            <>
              {chatVisible ? <PaneResizer onPointerDown={chatPane.start} /> : null}
              <div
                ref={chatPane.frameRef}
                style={{ width: chatVisible ? chatPane.width : 0 }}
                className={cn(
                  PANE_FRAME,
                  chatVisible && "[[data-panel-animations=true]_&]:starting:w-0!",
                  !chatVisible && "pointer-events-none",
                )}
              >
                <div
                  ref={chatPane.paneRef}
                  style={{ width: chatPane.width }}
                  className={`${PANE_CHAT} shrink-0`}
                >
                  <AssistantChatPanel
                    closeTabRef={closeChatTabRef}
                    accountId={selectedMessageId ? readerAccount : null}
                    messageId={selectedMessageId}
                    selectedRows={chatSelection}
                    quote={pendingQuote}
                    onClearQuote={() => setPendingQuote(null)}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Pinned titlebar toggles (Otter Code): same window spot whatever the panes do. */}
      <SidebarControl sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      {!settingsRoute ? (
        <PanelControl
          open={chatOpen}
          onToggle={() => {
            if (chatOpen) setPendingQuote(null);
            toggleChat();
          }}
        />
      ) : null}

      {accounts.length > 0 ? (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          accounts={accounts}
          views={views}
          selectedAccountId={effectiveAccountId}
          onOpenMessage={handlePaletteOpenMessage}
          onSearchMail={(q) => openSearch(q)}
          onGoToView={handlePaletteGoToView}
          onSelectAccount={handleSelectAccount}
          onCompose={() => setComposeOpen(true)}
          onOpenSettings={() => setSettingsRoute({ pane: "general", viewId: null, mailbox: null })}
          onNewView={() =>
            setSettingsRoute({
              pane: "views",
              viewId: "new",
              mailbox: isCombined ? COMBINED_ACCOUNT_ID : effectiveAccountId,
            })
          }
          onToggleChat={toggleChat}
          onToggleSidebar={toggleSidebar}
          onSync={syncNow}
        />
      ) : null}
    </>
  );
}
