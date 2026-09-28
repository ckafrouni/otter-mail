import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArchiveXIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  MailsIcon,
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
  InboxIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  SquarePenIcon,
  StarIcon,
  SunIcon,
  SunMoonIcon,
  Trash2Icon,
} from "lucide-react";
import { useDebouncedValue, useSearchMessages } from "./hooks";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { cn } from "./ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { APP_THEMES, setThemeForAppearance, useThemeChoice } from "../theme/apply-theme";
import type { GmailAccount, GmailMessageSummary, MailView } from "./types";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";

/**
 * Command palette (⌘K), modeled on Otter Code's: a frosted card anchored near
 * the top, a large search field, grouped results (icon, title, optional
 * subtitle, trailing time or shortcut), submenus (Backspace goes back), and a
 * key-hint footer. Mail search runs across every account.
 */

const MAX_MAIL_RESULTS = 12;

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: GmailAccount[];
  views: MailView[];
  selectedAccountId: string | null;
  onOpenMessage: (message: GmailMessageSummary) => void;
  /** Runs the typed text as a Gmail search in the Search mailbox. */
  onSearchMail: (query: string) => void;
  onGoToView: (viewId: string) => void;
  onSelectAccount: (accountId: string) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
  onNewView: () => void;
  onToggleChat: () => void;
  onToggleSidebar: () => void;
  onSync: () => void;
};

type Page = "root" | "appearance" | "theme";

type PaletteItem = {
  id: string;
  icon: ReactNode;
  title: string;
  description?: string;
  /** Searchable text beyond the title (e.g. a view's mailbox). */
  keywords?: string;
  trailing?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  /** Opens a submenu instead of running. */
  submenu?: Page;
  run?: () => void;
};

type PaletteGroup = { id: string; label: string; items: PaletteItem[] };

const ICON = "size-4";

function viewIcon(view: MailView): ReactNode {
  if (view.kind === "inbox") return <InboxIcon className={ICON} />;
  if (view.kind === "starred") return <StarIcon className={ICON} />;
  if (view.kind === "sent") return <SendIcon className={ICON} />;
  if (view.kind === "drafts") return <FileIcon className={ICON} />;
  if (view.kind === "important") return <BookmarkIcon className={ICON} />;
  if (view.kind === "allmail") return <MailsIcon className={ICON} />;
  if (view.kind === "junk") return <ArchiveXIcon className={ICON} />;
  if (view.kind === "trash") return <Trash2Icon className={ICON} />;
  return <LayersIcon className={ICON} />;
}

function formatResultDate(timestamp: number): string {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Dot({ color }: { color: string }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded bg-foreground/[0.08] px-1 font-sans text-xs font-medium text-foreground [&_svg]:size-3">
      {children}
    </kbd>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  accounts,
  views,
  selectedAccountId,
  onOpenMessage,
  onSearchMail,
  onGoToView,
  onSelectAccount,
  onCompose,
  onOpenSettings,
  onNewView,
  onToggleChat,
  onToggleSidebar,
  onSync,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const themeChoice = useThemeChoice();
  const [scheme, setScheme] = useState<"system" | "light" | "dark">("system");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPage("root");
    setHighlight(0);
    void window.desktopBridge.nativeTheme
      .getInfo()
      .then((info) => setScheme(info.themeSource))
      .catch(() => {});
  }, [open]);

  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, page]);

  const debouncedQuery = useDebouncedValue(query.trim(), 150);
  const searchResults = useSearchMessages(page === "root" ? debouncedQuery : "", null, open);
  const mailResults = (searchResults.data?.pages[0]?.messages ?? []).slice(0, MAX_MAIL_RESULTS);

  const close = () => onOpenChange(false);

  // Shortcut labels follow the live keybindings (Settings › Keybindings).
  const { resolved: keybindings } = useKeybindingsState();
  const groups: PaletteGroup[] = useMemo(() => {
    const sc = (command: KeybindingCommand) => shortcutLabelFor(keybindings, command) ?? undefined;
    const jump = (digit: number) => sc(`mailbox.jump.${digit}` as KeybindingCommand);
    const needle = query.trim().toLowerCase();
    const matches = (item: PaletteItem) =>
      !needle ||
      `${item.title} ${item.description ?? ""} ${item.keywords ?? ""}`
        .toLowerCase()
        .includes(needle);
    const filter = (list: PaletteGroup[]) =>
      list.map((g) => ({ ...g, items: g.items.filter(matches) })).filter((g) => g.items.length > 0);

    if (page === "appearance") {
      const options = [
        { id: "system", title: "System", icon: <MonitorIcon className={ICON} /> },
        { id: "light", title: "Light", icon: <SunIcon className={ICON} /> },
        { id: "dark", title: "Dark", icon: <MoonIcon className={ICON} /> },
      ] as const;
      return filter([
        {
          id: "appearance",
          label: "Change appearance",
          items: options.map((o) => ({
            id: `appearance:${o.id}`,
            icon: o.icon,
            title: o.title,
            checked: scheme === o.id,
            run: () => void window.desktopBridge.nativeTheme.setThemeSource(o.id),
          })),
        },
      ]);
    }

    if (page === "theme") {
      return filter([
        {
          id: "theme",
          label: "Change theme",
          items: APP_THEMES.map((t) => ({
            id: `theme:${t.id}`,
            icon: <PaletteIcon className={ICON} />,
            title: t.label,
            checked: themeChoice.light === t.id && themeChoice.dark === t.id,
            run: () => {
              setThemeForAppearance("light", t.id);
              setThemeForAppearance("dark", t.id);
            },
          })),
        },
      ]);
    }

    const actions: PaletteItem[] = [
      {
        id: "compose",
        icon: <SquarePenIcon className={ICON} />,
        title: "New message",
        shortcut: sc("compose.new"),
        run: onCompose,
      },
      { id: "sync", icon: <RotateCwIcon className={ICON} />, title: "Sync now", run: onSync },
      {
        id: "chat",
        icon: <PanelRightIcon className={ICON} />,
        title: "Toggle assistant panel",
        keywords: "chat assistant ai hermes codex",
        shortcut: sc("assistant.toggle"),
        run: onToggleChat,
      },
      {
        id: "sidebar",
        icon: <PanelLeftIcon className={ICON} />,
        title: "Toggle sidebar",
        shortcut: sc("sidebar.toggle"),
        run: onToggleSidebar,
      },
      {
        id: "appearance",
        icon: <SunMoonIcon className={ICON} />,
        title: "Change appearance",
        keywords: "dark light system mode",
        submenu: "appearance",
      },
      {
        id: "theme",
        icon: <PaletteIcon className={ICON} />,
        title: "Change theme",
        keywords: "colors palette",
        submenu: "theme",
      },
      { id: "new-view", icon: <PlusIcon className={ICON} />, title: "New view", run: onNewView },
      {
        id: "settings",
        icon: <SettingsIcon className={ICON} />,
        title: "Settings",
        shortcut: "⌘,",
        run: onOpenSettings,
      },
    ];

    const mailboxes: PaletteItem[] = [
      ...(accounts.length > 1
        ? [
            {
              id: `mailbox:${COMBINED_ACCOUNT_ID}`,
              icon: <LayersIcon className={ICON} />,
              title: "All mailboxes",
              shortcut: jump(1),
              checked: selectedAccountId === COMBINED_ACCOUNT_ID,
              run: () => onSelectAccount(COMBINED_ACCOUNT_ID),
            },
          ]
        : []),
      ...accounts.map((account, i) => ({
        id: `mailbox:${account.id}`,
        icon: <Dot color={getAccountColor(account)} />,
        title: getAccountDisplayName(account),
        description: account.email,
        shortcut: jump(accounts.length > 1 ? i + 2 : 1),
        checked: selectedAccountId === account.id,
        run: () => onSelectAccount(account.id),
      })),
    ];

    // Combined views are only offered when 2+ accounts are connected (matches the sidebar).
    const viewItems: PaletteItem[] =
      accounts.length > 1
        ? views
            .filter((v) => (v.mailbox ?? COMBINED_ACCOUNT_ID) === COMBINED_ACCOUNT_ID)
            .map((view) => ({
              id: `view:${view.id}`,
              icon: viewIcon(view),
              title: view.name,
              keywords: "go to view",
              run: () => onGoToView(view.id),
            }))
        : [];

    const staticGroups = filter([
      { id: "actions", label: "Actions", items: actions },
      { id: "mailboxes", label: "Mailboxes", items: mailboxes },
      { id: "views", label: "Views", items: viewItems },
    ]);

    const mail: PaletteItem[] = needle
      ? mailResults.map((message) => {
          const account = accounts.find((a) => a.id === message.accountId);
          return {
            id: `message:${message.accountId}:${message.id}`,
            icon: account ? (
              <Dot color={getAccountColor(account)} />
            ) : (
              <InboxIcon className={ICON} />
            ),
            title: message.fromName || message.fromEmail,
            description: message.subject || "(no subject)",
            trailing: formatResultDate(message.date),
            run: () => onOpenMessage(message),
          };
        })
      : [];

    // First option while typing: hand the text to the Search mailbox (Gmail's
    // own search, every operator), like pressing Enter in Gmail's search bar.
    const searchGroup = needle
      ? [
          {
            id: "search",
            label: "Search",
            items: [
              {
                id: "search-mail",
                icon: <SearchIcon className={ICON} />,
                title: `Search mail for “${query.trim()}”`,
                run: () => onSearchMail(query.trim()),
              },
            ],
          },
        ]
      : [];

    return [
      ...searchGroup,
      ...staticGroups,
      ...(mail.length > 0 ? [{ id: "mail", label: "Mail", items: mail }] : []),
    ];
  }, [
    keybindings,
    page,
    query,
    scheme,
    themeChoice,
    accounts,
    views,
    selectedAccountId,
    mailResults,
    onCompose,
    onSync,
    onToggleChat,
    onToggleSidebar,
    onNewView,
    onOpenSettings,
    onSelectAccount,
    onGoToView,
    onOpenMessage,
    onSearchMail,
  ]);

  const flat = groups.flatMap((g) => g.items);
  const clamped = Math.min(highlight, Math.max(flat.length - 1, 0));

  useEffect(() => setHighlight(0), [query, page]);

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clamped]);

  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.submenu) {
      console.log("[CommandPalette:submenu]", { page: item.submenu });
      setQuery("");
      setPage(item.submenu);
      return;
    }
    console.log("[CommandPalette:run]", { id: item.id });
    close();
    item.run?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (flat.length ? (Math.min(h, flat.length - 1) + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) =>
        flat.length ? (Math.min(h, flat.length - 1) - 1 + flat.length) % flat.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(flat[clamped]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Backspace" && query === "" && page !== "root") {
      e.preventDefault();
      setPage("root");
    }
  };

  if (!open) return null;

  const searching = page === "root" && debouncedQuery !== "" && searchResults.isLoading;
  const placeholder =
    page === "appearance"
      ? "Change appearance…"
      : page === "theme"
        ? "Change theme…"
        : "Search mail or type a command…";
  let index = -1;

  return createPortal(
    <div className="no-drag fixed inset-0 z-[100]" role="presentation">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-canvas/60 backdrop-blur-[4px]"
        onPointerDown={close}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center px-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="dialog-glass pointer-events-auto relative flex max-h-105 w-full max-w-xl flex-col overflow-hidden rounded-2xl border text-foreground"
        >
          {/* Search field */}
          <div className="relative flex h-12 shrink-0 items-center gap-2.5 px-4">
            <SearchIcon className="size-4 shrink-0 text-icon-muted" aria-hidden />
            <input
              ref={inputRef}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Search commands and mail"
              className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-placeholder"
            />
          </div>

          {/* Results */}
          <div
            ref={listRef}
            className="min-h-0 flex-1 scroll-py-2 overflow-y-auto border-t border-border/60 p-2"
          >
            {flat.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {searching ? "Searching…" : "No matching commands or mail."}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="[&+&]:mt-1.5" role="group" aria-label={group.label}>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    const active = i === clamped;
                    return (
                      <div
                        key={item.id}
                        role="option"
                        aria-selected={active}
                        data-index={i}
                        onMouseMove={() => setHighlight(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execute(item)}
                        className={cn(
                          "flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none [&_svg:not([class*='text-'])]:text-muted-foreground",
                          active && "bg-foreground/[0.09] text-foreground",
                        )}
                      >
                        {item.icon}
                        {item.description ? (
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm text-foreground">{item.title}</span>
                            <span className="truncate text-xs text-muted-foreground/70">
                              {item.description}
                            </span>
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {item.title}
                          </span>
                        )}
                        {item.checked ? (
                          <CheckIcon className="size-3.5 shrink-0 text-foreground" />
                        ) : null}
                        {item.trailing ? (
                          <span className="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
                            {item.trailing}
                          </span>
                        ) : null}
                        {item.shortcut ? (
                          <kbd className="ms-auto shrink-0 font-sans text-xs font-medium tracking-widest text-secondary-label">
                            {item.shortcut}
                          </kbd>
                        ) : null}
                        {item.submenu ? (
                          <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Key hints */}
          <div className="flex shrink-0 items-center gap-3 bg-foreground/[0.025] px-4 py-2.5 text-sm font-medium text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span className="ms-1">Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd>
              <span className="ms-1">{flat[clamped]?.submenu ? "Open" : "Select"}</span>
            </span>
            {page !== "root" ? (
              <span className="flex items-center gap-1">
                <Kbd>Backspace</Kbd>
                <span className="ms-1">Back</span>
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
              <span className="ms-1">Close</span>
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
