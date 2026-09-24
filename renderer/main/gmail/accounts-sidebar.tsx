import {
  useState,
  type CSSProperties,
  type RefObject,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  Field,
  Input,
  Text,
  toast,
} from "@glaze/core/components";
import {
  InboxIcon,
  StarIcon,
  SendIcon,
  FileIcon,
  BookmarkIcon,
  ArchiveXIcon,
  Trash2Icon,
  SettingsIcon,
  PlusIcon,
  ChevronDownIcon,
  LayersIcon,
  TagIcon,
  SearchIcon,
  SquarePenIcon,
  XIcon,
  CommandIcon,
  RotateCwIcon,
} from "lucide-react";
import {
  useAccounts,
  useLabels,
  useAddAccount,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useViewUnreadCounts,
} from "./hooks";
import type { GmailLabel, MailView } from "./types";
import { gmailApi } from "./api";
import { COMBINED_ACCOUNT_ID, useMailViews } from "./custom-views";
import { buildLabelTree, type LabelTreeNode } from "./label-tree";
import { UnreadPill, HintTooltip, IconBtn } from "./ui";
import { MailboxSwitcher, WindowTitle } from "./top-bar";

const LABEL_DRAG_MIME = "application/x-gmail-label";

type LabelDragPayload = { id: string; name: string };

type RowDragProps = {
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLButtonElement>) => void;
};

/** Gmail's labels API only accepts colors from its fixed palette. */
const GMAIL_LABEL_COLORS: { backgroundColor: string; textColor: string }[] = [
  { backgroundColor: "#fb4c2f", textColor: "#ffffff" },
  { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  { backgroundColor: "#efa093", textColor: "#000000" },
  { backgroundColor: "#ff7537", textColor: "#ffffff" },
  { backgroundColor: "#ffad47", textColor: "#000000" },
  { backgroundColor: "#ffd6a2", textColor: "#000000" },
  { backgroundColor: "#fad165", textColor: "#000000" },
  { backgroundColor: "#fcda83", textColor: "#000000" },
  { backgroundColor: "#16a766", textColor: "#ffffff" },
  { backgroundColor: "#149e60", textColor: "#ffffff" },
  { backgroundColor: "#43d692", textColor: "#000000" },
  { backgroundColor: "#89d3b2", textColor: "#000000" },
  { backgroundColor: "#4a86e8", textColor: "#ffffff" },
  { backgroundColor: "#3c78d8", textColor: "#ffffff" },
  { backgroundColor: "#285bac", textColor: "#ffffff" },
  { backgroundColor: "#a4c2f4", textColor: "#000000" },
  { backgroundColor: "#a479e2", textColor: "#ffffff" },
  { backgroundColor: "#8e63ce", textColor: "#ffffff" },
  { backgroundColor: "#b99aff", textColor: "#000000" },
  { backgroundColor: "#f691b3", textColor: "#000000" },
  { backgroundColor: "#e07798", textColor: "#ffffff" },
  { backgroundColor: "#666666", textColor: "#ffffff" },
  { backgroundColor: "#999999", textColor: "#ffffff" },
  { backgroundColor: "#cccccc", textColor: "#000000" },
];

const SIDEBAR_SYSTEM_ORDER = ["INBOX", "STARRED", "SENT", "DRAFT", "IMPORTANT", "SPAM", "TRASH"];

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-3.5" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-3.5" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-3.5" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-3.5" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-3.5" /> },
  SPAM: { name: "Junk", icon: <ArchiveXIcon className="size-3.5" /> },
  TRASH: { name: "Trash", icon: <Trash2Icon className="size-3.5" /> },
};

function viewIcon(view: MailView): ReactNode {
  if (view.kind === "inbox") return <InboxIcon className="size-3.5" />;
  if (view.kind === "starred") return <StarIcon className="size-3.5" />;
  if (view.kind === "sent") return <SendIcon className="size-3.5" />;
  if (view.kind === "drafts") return <FileIcon className="size-3.5" />;
  if (view.kind === "important") return <BookmarkIcon className="size-3.5" />;
  if (view.kind === "junk") return <ArchiveXIcon className="size-3.5" />;
  if (view.kind === "trash") return <Trash2Icon className="size-3.5" />;
  return <LayersIcon className="size-3.5" />;
}

/** Sidebar row: muted at rest, inverted block when selected; counts live in the badge only. */
function SkRow({
  icon,
  title,
  selected,
  badge,
  trailing,
  depth = 0,
  onClick,
  dragProps,
  dropActive,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
  badge?: number;
  trailing?: ReactNode;
  depth?: number;
  onClick?: () => void;
  dragProps?: RowDragProps;
  dropActive?: boolean;
}) {
  const style: CSSProperties = { paddingLeft: 10 + depth * 16 };
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      {...dragProps}
      className={[
        "group flex h-8 w-full cursor-pointer items-center gap-(--sidebar-control-gap) rounded-[var(--control-radius)] pr-(--sidebar-row-content-inset) text-left text-sm font-medium outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active",
        selected
          ? "bg-sidebar-row-selected text-sidebar-foreground"
          : "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        dropActive ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0",
          selected
            ? "text-sidebar-foreground"
            : "text-(--sidebar-icon-color) group-hover:text-sidebar-foreground",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? (
        // One trailing slot: the count at rest, the row action on hover, so
        // the action never reserves dead space next to the count.
        <span className="relative ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
          {badge != null && badge > 0 ? (
            <span className="group-hover:invisible group-focus-within:invisible">
              <UnreadPill count={badge} selected={selected} />
            </span>
          ) : null}
          <span className="absolute inset-y-0 right-0 flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {trailing}
          </span>
        </span>
      ) : badge != null ? (
        <UnreadPill count={badge} selected={selected} />
      ) : null}
    </button>
  );
}

function Section({
  title,
  action,
  children,
  dropZone,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  dropZone?: {
    active: boolean;
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  };
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3">
      <div
        className={[
          "group flex h-7 items-center gap-1 rounded-md pr-1",
          dropZone?.active ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
        ].join(" ")}
        onDragOver={dropZone?.onDragOver}
        onDragLeave={dropZone?.onDragLeave}
        onDrop={dropZone?.onDrop}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-sidebar-muted-foreground/70 hover:text-sidebar-foreground"
          aria-label={`Toggle ${title}`}
        >
          <ChevronDownIcon
            className={["size-3 transition-transform", open ? "" : "-rotate-90"].join(" ")}
          />
          {title}
        </button>
        <span className="flex-1" />
        <span className="opacity-0 group-hover:opacity-100">{action}</span>
      </div>
      {open ? children : null}
    </div>
  );
}

function SectionAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </HintTooltip>
  );
}

/** "+ Add …" footer row for a section. */
function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-[var(--control-radius)] px-2.5 text-left text-sm font-medium text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
    >
      <span className="flex size-4 items-center justify-center rounded-sm border border-sidebar-line">
        <PlusIcon className="size-3" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ViewRow({
  view,
  selected,
  unreadCount,
  onSelect,
  onEdit,
  onDelete,
  onReset,
}: {
  view: MailView;
  selected: boolean;
  unreadCount: number;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReset: () => void;
}): ReactNode {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SkRow
          icon={viewIcon(view)}
          title={view.name}
          selected={selected}
          badge={unreadCount}
          onClick={() => {
            console.log("[AccountsSidebar:selectView]", { viewId: view.id });
            onSelect();
          }}
          trailing={
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Edit ${view.name}`}
              className={[
                "flex shrink-0 items-center",
                selected
                  ? "text-sidebar-foreground/70"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <SettingsIcon className="size-3.5" />
            </span>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon="pencil" onSelect={onEdit}>
          Edit View…
        </ContextMenuItem>
        <ContextMenuSeparator />
        {view.kind === "custom" ? (
          <ContextMenuItem icon="trash" color="red" onSelect={onDelete}>
            Delete View
          </ContextMenuItem>
        ) : (
          <ContextMenuItem icon="arrow.counterclockwise" onSelect={onReset}>
            Reset to Default
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function labelIcon(label?: GmailLabel): ReactNode {
  const color = label?.color?.backgroundColor;
  if (color) {
    return <TagIcon className="size-4 fill-current" style={{ color }} />;
  }
  return <TagIcon className="size-4" />;
}

type LabelActions = {
  onRename: (label: GmailLabel) => void;
  onRecolor: (label: GmailLabel) => void;
  onDelete: (label: GmailLabel) => void;
  onMove: (source: LabelDragPayload, targetParentName: string | null) => void;
};

function LabelNode({
  node,
  depth,
  selectedLabelId,
  onSelectLabel,
  actions,
}: {
  node: LabelTreeNode;
  depth: number;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  actions: LabelActions;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);
  const { label, children } = node;
  const unread = label?.unread && label.unread > 0 ? label.unread : 0;
  const hasChildren = children.length > 0;

  // Drag to nest: rows are both sources and targets. Drop payloads aren't
  // readable during dragover, so self/descendant checks happen on drop.
  const dragProps: RowDragProps | undefined = label
    ? {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.setData(
            LABEL_DRAG_MIME,
            JSON.stringify({ id: label.id, name: label.name } satisfies LabelDragPayload),
          );
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes(LABEL_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropActive(true);
        },
        onDragLeave: () => setDropActive(false),
        onDrop: (e) => {
          setDropActive(false);
          const raw = e.dataTransfer.getData(LABEL_DRAG_MIME);
          if (!raw) return;
          e.preventDefault();
          actions.onMove(JSON.parse(raw) as LabelDragPayload, label.name);
        },
      }
    : undefined;

  const row = (
    <SkRow
      icon={
        hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={open ? `Collapse ${node.segment}` : `Expand ${node.segment}`}
            className="flex items-center"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <ChevronDownIcon
              className={["size-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
            />
          </span>
        ) : (
          labelIcon(label)
        )
      }
      title={node.segment}
      depth={depth}
      selected={label ? selectedLabelId === label.id : false}
      badge={unread}
      dragProps={dragProps}
      dropActive={dropActive}
      onClick={
        label
          ? () => {
              console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
              onSelectLabel(label.id);
            }
          : () => setOpen((o) => !o)
      }
    />
  );

  return (
    <>
      {label ? (
        <ContextMenu>
          <ContextMenuTrigger>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem icon="pencil" onSelect={() => actions.onRename(label)}>
              Rename…
            </ContextMenuItem>
            <ContextMenuItem icon="paintpalette" onSelect={() => actions.onRecolor(label)}>
              Change Color…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon="trash" color="red" onSelect={() => actions.onDelete(label)}>
              Delete Label
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {open
        ? children.map((child) => (
            <LabelNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedLabelId={selectedLabelId}
              onSelectLabel={onSelectLabel}
              actions={actions}
            />
          ))
        : null}
    </>
  );
}

type AccountsSidebarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Footer utilities. */
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onSync: () => void;
  syncing: boolean;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  views: MailView[];
  onCompose: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
};

export function AccountsSidebar({
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onOpenPalette,
  onSync,
  syncing,
  selectedAccountId,
  onSelectAccount,
  selectedLabelId,
  onSelectLabel,
  views,
  onCompose,
  searchQuery,
  onSearchChange,
  searchRef,
  searchPlaceholder,
}: AccountsSidebarProps) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const accountsQuery = useAccounts();
  const labelsQuery = useLabels(isCombined ? null : selectedAccountId);
  const addAccount = useAddAccount();
  const createLabel = useCreateLabel();

  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const updateLabel = useUpdateLabel();
  const deleteLabelMutation = useDeleteLabel();
  const [renameTarget, setRenameTarget] = useState<GmailLabel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [colorTarget, setColorTarget] = useState<GmailLabel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GmailLabel | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  const accounts = accountsQuery.data ?? [];
  const labels: GmailLabel[] = labelsQuery.data ?? [];
  // Views belong to one mailbox; each mailbox (account or Combined) lists its own.
  const countScope = isCombined ? accounts : accounts.filter((a) => a.id === selectedAccountId);
  const viewUnreadCounts = useViewUnreadCounts(views, countScope, true);
  const accountViews = isCombined
    ? []
    : views.filter((v) => v.kind === "custom" && v.mailbox === selectedAccountId);
  const combinedViews = views.filter(
    (v) => v.kind === "custom" && (v.mailbox ?? COMBINED_ACCOUNT_ID) === COMBINED_ACCOUNT_ID,
  );
  const { deleteView, resetView } = useMailViews();

  // Same order as the Combined built-in views, Important appended.
  const systemLabels = labels
    .filter((l) => l.type === "system" && l.id in SYSTEM_LABEL_MAP)
    .sort((a, b) => SIDEBAR_SYSTEM_ORDER.indexOf(a.id) - SIDEBAR_SYSTEM_ORDER.indexOf(b.id));
  const userLabels = labels.filter((l) => l.type === "user");
  const userLabelTree = buildLabelTree(userLabels);

  const handleAddAccount = async () => {
    console.log("[AccountsSidebar:addAccount]");
    try {
      const account = await addAccount.mutateAsync();
      onSelectAccount(account.id);
    } catch {
      // error surfaced by mutation
    }
  };

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || !selectedAccountId) return;
    console.log("[AccountsSidebar:createLabel]", { name });
    try {
      await createLabel.mutateAsync({ accountId: selectedAccountId, name });
      toast.success(`Label "${name}" created`);
      setCreateLabelOpen(false);
      setNewLabelName("");
    } catch {
      toast.error("Failed to create label");
    }
  };

  const handleMoveLabel = (source: LabelDragPayload, targetParentName: string | null) => {
    if (!selectedAccountId) return;
    if (
      targetParentName &&
      (targetParentName === source.name || targetParentName.startsWith(`${source.name}/`))
    ) {
      toast.error("Can't nest a label inside itself");
      return;
    }
    const segment = source.name.split("/").pop() ?? source.name;
    const newName = targetParentName ? `${targetParentName}/${segment}` : segment;
    if (newName === source.name) return;
    console.log("[AccountsSidebar:moveLabel]", { from: source.name, to: newName });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: source.id, name: newName })
      .catch(() => toast.error("Could not move the label"));
  };

  const handleRenameConfirm = () => {
    const name = renameValue.trim();
    const target = renameTarget;
    setRenameTarget(null);
    if (!target || !name || !selectedAccountId || name === target.name) return;
    console.log("[AccountsSidebar:renameLabel]", { from: target.name, to: name });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id, name })
      .catch(() => toast.error("Could not rename the label"));
  };

  const handlePickColor = (color: { backgroundColor: string; textColor: string }) => {
    const target = colorTarget;
    setColorTarget(null);
    if (!target || !selectedAccountId) return;
    console.log("[AccountsSidebar:recolorLabel]", {
      label: target.name,
      color: color.backgroundColor,
    });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id, color })
      .catch(() => toast.error("Could not change the color"));
  };

  const handleDeleteConfirm = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !selectedAccountId) return;
    if (selectedLabelId === target.id) onSelectLabel("INBOX");
    console.log("[AccountsSidebar:deleteLabel]", { label: target.name });
    deleteLabelMutation
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id })
      .catch(() => toast.error("Could not delete the label"));
  };

  const labelActions: LabelActions = {
    onRename: (label) => {
      setRenameValue(label.name);
      setRenameTarget(label);
    },
    onRecolor: (label) => setColorTarget(label),
    onDelete: (label) => setDeleteTarget(label),
    onMove: handleMoveLabel,
  };

  const openViewEditor = (viewId: string) => {
    void gmailApi.openSettings({
      pane: "views",
      viewId,
      mailbox: isCombined ? COMBINED_ACCOUNT_ID : selectedAccountId,
    });
  };

  const viewRow = (view: MailView) => (
    <ViewRow
      key={view.id}
      view={view}
      selected={selectedLabelId === view.id}
      unreadCount={viewUnreadCounts[view.id] ?? 0}
      onSelect={() => onSelectLabel(view.id)}
      onDelete={() => void deleteView(view.id)}
      onReset={() => void resetView(view.id)}
      onEdit={() => openViewEditor(view.id)}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <WindowTitle sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />

      {/* Mailbox switcher row (All mailboxes / an account). */}
      <div className="shrink-0 px-(--sidebar-content-inset) pb-1">
        <MailboxSwitcher
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={onSelectAccount}
        />
      </div>

      {/* Search row + compose, like the workspace sidebar. */}
      <div className="flex h-10 shrink-0 items-center gap-1 px-(--sidebar-content-inset)">
        <label className="group/search flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-[var(--control-radius)] px-(--sidebar-row-content-inset) transition-colors hover:bg-sidebar-row-hover focus-within:bg-sidebar-row-hover">
          <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color) group-focus-within/search:text-sidebar-foreground" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearchChange("");
                e.currentTarget.blur();
              }
            }}
            placeholder={searchPlaceholder}
            aria-label="Search mail"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </label>
        <HintTooltip label="New message" hint="C">
          <IconBtn label="New message" onClick={onCompose}>
            <SquarePenIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-(--sidebar-content-inset) pb-4 pt-1">
        {isCombined ? (
          <>
            {views
              .filter((v) => v.kind !== "custom")
              .map((view) => (
                <SkRow
                  key={view.id}
                  icon={viewIcon(view)}
                  title={view.name}
                  selected={selectedLabelId === view.id}
                  badge={viewUnreadCounts[view.id] ?? 0}
                  onClick={() => {
                    console.log("[AccountsSidebar:selectView]", { viewId: view.id });
                    onSelectLabel(view.id);
                  }}
                />
              ))}

            <Section
              title="Views"
              action={<SectionAddButton label="Add view" onClick={() => openViewEditor("new")} />}
            >
              {combinedViews.map(viewRow)}
            </Section>
          </>
        ) : (
          <>
            {(systemLabels.length > 0
              ? systemLabels.map((l) => ({ id: l.id, unread: l.unread ?? 0, total: l.total ?? 0 }))
              : Object.keys(SYSTEM_LABEL_MAP).map((id) => ({ id, unread: 0, total: 0 }))
            ).map(({ id, unread, total }) => {
              const meta = SYSTEM_LABEL_MAP[id];
              if (!meta) return null;
              // Drafts is a raw count of drafts, not an unread signal.
              const isDrafts = id === "DRAFT";
              return (
                <SkRow
                  key={id}
                  icon={meta.icon}
                  title={meta.name}
                  selected={selectedLabelId === id}
                  badge={isDrafts ? total : unread}
                  onClick={() => {
                    console.log("[AccountsSidebar:selectLabel]", { labelId: id });
                    onSelectLabel(id);
                  }}
                />
              );
            })}

            <Section
              title="Views"
              action={<SectionAddButton label="Add view" onClick={() => openViewEditor("new")} />}
            >
              {accountViews.map(viewRow)}
            </Section>

            {selectedAccountId ? (
              <Section
                title="Labels"
                action={
                  <SectionAddButton label="Add label" onClick={() => setCreateLabelOpen(true)} />
                }
                dropZone={{
                  active: rootDropActive,
                  onDragOver: (e) => {
                    if (!e.dataTransfer.types.includes(LABEL_DRAG_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setRootDropActive(true);
                  },
                  onDragLeave: () => setRootDropActive(false),
                  onDrop: (e) => {
                    setRootDropActive(false);
                    const raw = e.dataTransfer.getData(LABEL_DRAG_MIME);
                    if (!raw) return;
                    e.preventDefault();
                    handleMoveLabel(JSON.parse(raw) as LabelDragPayload, null);
                  },
                }}
              >
                {userLabelTree.map((node) => (
                  <LabelNode
                    key={node.key}
                    node={node}
                    depth={0}
                    selectedLabelId={selectedLabelId}
                    onSelectLabel={onSelectLabel}
                    actions={labelActions}
                  />
                ))}
              </Section>
            ) : null}

            {accounts.length === 0 ? (
              <AddRow label="Add Gmail account" onClick={() => void handleAddAccount()} />
            ) : null}
          </>
        )}
      </div>

      {/* Footer utilities, like the workspace sidebar's bottom row. */}
      <div className="flex shrink-0 items-center gap-1 px-(--sidebar-content-inset) py-1">
        <HintTooltip label="Settings" hint="⌘,">
          <IconBtn label="Settings" onClick={onOpenSettings} className="size-8">
            <SettingsIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Jump to anything" hint="⌘K">
          <IconBtn label="Command palette" onClick={onOpenPalette} className="size-8">
            <CommandIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <span className="flex-1" />
        <HintTooltip label={syncing ? "Syncing…" : "Sync now"}>
          <IconBtn label="Sync now" onClick={onSync} disabled={syncing} className="size-8">
            <RotateCwIcon className={syncing ? "size-4 animate-spin" : "size-4"} />
          </IconBtn>
        </HintTooltip>
      </div>

      <Dialog
        open={createLabelOpen}
        onOpenChange={setCreateLabelOpen}
        title="New Label"
        confirmLabel="Create"
        confirmVariant="accent"
        confirmDisabled={!newLabelName.trim() || createLabel.isPending}
        onConfirm={handleCreateLabel}
      >
        <Field label="Name" orientation="vertical">
          <Input
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="e.g. 04 Follow-up"
            autoFocus
          />
        </Field>
      </Dialog>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null);
        }}
        title="Rename Label"
        confirmLabel="Rename"
        confirmVariant="accent"
        confirmDisabled={!renameValue.trim()}
        onConfirm={handleRenameConfirm}
      >
        <Field label="Name" orientation="vertical">
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="e.g. 90 Ops/alerts"
            autoFocus
          />
        </Field>
        <Text variant="mini" color="tertiary">
          Use / to nest, e.g. "90 Ops/alerts". Nested labels move along.
        </Text>
      </Dialog>

      <Dialog
        open={colorTarget != null}
        onOpenChange={(o) => {
          if (!o) setColorTarget(null);
        }}
        title={colorTarget ? `Color for "${colorTarget.name.split("/").pop()}"` : "Label Color"}
      >
        <div className="grid grid-cols-8 gap-2 py-1">
          {GMAIL_LABEL_COLORS.map((color) => (
            <button
              key={color.backgroundColor}
              type="button"
              aria-label={`Use ${color.backgroundColor}`}
              onClick={() => handlePickColor(color)}
              className={[
                "size-6 rounded-full",
                colorTarget?.color?.backgroundColor === color.backgroundColor
                  ? "ring-2 ring-accent ring-offset-1"
                  : "hover:ring-2 hover:ring-input",
              ].join(" ")}
              style={{ backgroundColor: color.backgroundColor }}
            />
          ))}
        </div>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Delete Label"
        confirmLabel="Delete"
        confirmVariant="accent"
        onConfirm={handleDeleteConfirm}
      >
        <Text variant="small">
          Delete "{deleteTarget?.name}"? It is removed from every message; the messages themselves
          and any nested labels are kept.
        </Text>
      </Dialog>
    </div>
  );
}
