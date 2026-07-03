import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  Field,
  Input,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
} from "lucide-react";
import { useAccounts, useLabels, useAddAccount, useCreateLabel, useViewUnreadCounts } from "./hooks";
import type { GmailLabel, MailView } from "./types";
import { gmailApi } from "./api";
import { COMBINED_ACCOUNT_ID, useMailViews } from "./custom-views";
import { buildLabelTree, type LabelTreeNode } from "./label-tree";
import { getAccountDisplayName } from "./account-style";
import { UnreadPill, HintTooltip } from "./slack-ui";

const SIDEBAR_SYSTEM_ORDER = ["INBOX", "STARRED", "SENT", "DRAFT", "IMPORTANT", "SPAM", "TRASH"];

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-4" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-4" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-4" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-4" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-4" /> },
  SPAM: { name: "Junk", icon: <ArchiveXIcon className="size-4" /> },
  TRASH: { name: "Trash", icon: <Trash2Icon className="size-4" /> },
};

function viewIcon(view: MailView): ReactNode {
  if (view.kind === "inbox") return <InboxIcon className="size-4" />;
  if (view.kind === "starred") return <StarIcon className="size-4" />;
  if (view.kind === "sent") return <SendIcon className="size-4" />;
  if (view.kind === "drafts") return <FileIcon className="size-4" />;
  if (view.kind === "important") return <BookmarkIcon className="size-4" />;
  if (view.kind === "junk") return <ArchiveXIcon className="size-4" />;
  if (view.kind === "trash") return <Trash2Icon className="size-4" />;
  return <LayersIcon className="size-4" />;
}

/** Slack-style sidebar row: muted at rest, bold when unread, inverted pill when selected. */
function SkRow({
  icon,
  title,
  selected,
  unread,
  badge,
  trailing,
  depth = 0,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
  unread?: boolean;
  badge?: number;
  trailing?: ReactNode;
  depth?: number;
  onClick?: () => void;
}) {
  const style: CSSProperties = { paddingLeft: 8 + depth * 18 };
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={[
        "group flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-[15px] leading-none",
        selected
          ? "bg-(--sk-selected) font-medium text-(--sk-selected-fg)"
          : unread
            ? "font-bold text-(--sk-strong) hover:bg-(--sk-hover)"
            : "text-(--sk-muted) hover:bg-(--sk-hover) hover:text-(--sk-text)",
      ].join(" ")}
    >
      <span className={["shrink-0", selected ? "" : "opacity-80"].join(" ")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {badge != null ? <UnreadPill count={badge} selected={selected} /> : null}
      {trailing}
    </button>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4">
      <div className="group flex h-6 items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[13px] font-medium text-(--sk-faint) hover:text-(--sk-text)"
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
        className="flex size-5 items-center justify-center rounded text-(--sk-muted) hover:bg-(--sk-ctl) hover:text-(--sk-strong)"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </HintTooltip>
  );
}

/** Slack's "+ Add channels" style footer row for a section. */
function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[15px] leading-none text-(--sk-muted) hover:bg-(--sk-hover) hover:text-(--sk-text)"
    >
      <span className="flex size-4 items-center justify-center rounded bg-(--sk-ctl)">
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
          unread={unreadCount > 0}
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
                "shrink-0 opacity-0 group-hover:opacity-100",
                selected ? "text-(--sk-selected-fg)/70" : "text-(--sk-faint) hover:text-(--sk-strong)",
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
  return <TagIcon className="size-4 text-(--sk-faint)" />;
}

function LabelNode({
  node,
  depth,
  selectedLabelId,
  onSelectLabel,
}: {
  node: LabelTreeNode;
  depth: number;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const { label, children } = node;
  const unread = label?.unread && label.unread > 0 ? label.unread : 0;
  const hasChildren = children.length > 0;

  return (
    <>
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
        unread={unread > 0}
        badge={unread}
        onClick={
          label
            ? () => {
                console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
                onSelectLabel(label.id);
              }
            : () => setOpen((o) => !o)
        }
      />
      {open
        ? children.map((child) => (
            <LabelNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedLabelId={selectedLabelId}
              onSelectLabel={onSelectLabel}
            />
          ))
        : null}
    </>
  );
}

type AccountsSidebarProps = {
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  views: MailView[];
  onCompose: () => void;
  onOpenSearch: () => void;
};

export function AccountsSidebar({
  selectedAccountId,
  onSelectAccount,
  selectedLabelId,
  onSelectLabel,
  views,
  onCompose,
  onOpenSearch,
}: AccountsSidebarProps) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const accountsQuery = useAccounts();
  const labelsQuery = useLabels(isCombined ? null : selectedAccountId);
  const addAccount = useAddAccount();
  const createLabel = useCreateLabel();

  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");

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

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const mailboxTitle = isCombined
    ? "Combined"
    : selectedAccount
      ? getAccountDisplayName(selectedAccount)
      : "No account";

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
      {/* Header: mailbox switcher + compose */}
      <div className="drag-region flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-(--sk-border) px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Switch account"
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-(--sk-hover)"
            >
              <span className="truncate text-[17px] font-extrabold text-(--sk-strong)">{mailboxTitle}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-(--sk-muted)" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {accounts.length > 1 ? (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    console.log("[AccountsSidebar:selectAccount]", {
                      accountId: COMBINED_ACCOUNT_ID,
                    });
                    onSelectAccount(COMBINED_ACCOUNT_ID);
                  }}
                >
                  Combined (all mailboxes)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {accounts.map((account) => (
              <DropdownMenuItem
                key={account.id}
                onSelect={() => {
                  console.log("[AccountsSidebar:selectAccount]", { accountId: account.id });
                  onSelectAccount(account.id);
                }}
              >
                <span className="truncate">{account.email}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void gmailApi.openSettings({ pane: "accounts" })}>
              Manage accounts…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={onCompose}
          aria-label="New message"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--sk-selected) text-(--sk-selected-fg) shadow-sm hover:opacity-90"
        >
          <SquarePenIcon className="size-4" />
        </button>
      </div>

      {/* Find a conversation… (command palette) */}
      <div className="px-3 pb-1 pt-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-7 w-full items-center gap-2 rounded-md border border-(--sk-outline) px-2 text-[13px] text-(--sk-muted) hover:border-(--sk-outline-hover) hover:text-(--sk-text)"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="truncate">Find a conversation…</span>
          <span className="ml-auto shrink-0 text-[11px] text-(--sk-faint)">⌘K</span>
        </button>
      </div>

      <div className="sk-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {isCombined ? (
          <>
            {views.filter((v) => v.kind !== "custom").map(viewRow)}

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
              ? systemLabels.map((l) => ({ id: l.id, unread: l.unread ?? 0 }))
              : Object.keys(SYSTEM_LABEL_MAP).map((id) => ({ id, unread: 0 }))
            ).map(({ id, unread }) => {
              const meta = SYSTEM_LABEL_MAP[id];
              if (!meta) return null;
              return (
                <SkRow
                  key={id}
                  icon={meta.icon}
                  title={meta.name}
                  selected={selectedLabelId === id}
                  unread={unread > 0}
                  badge={unread}
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
              >
                {userLabelTree.map((node) => (
                  <LabelNode
                    key={node.key}
                    node={node}
                    depth={0}
                    selectedLabelId={selectedLabelId}
                    onSelectLabel={onSelectLabel}
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
    </div>
  );
}
