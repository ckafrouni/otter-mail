import { useState } from "react";
import type React from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Sidebar,
  SidebarList,
  SidebarListItem,
  SidebarListItemContent,
  SidebarListItemTitle,
  SidebarListItemAccessory,
  SidebarListGroup,
  SidebarFooter,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Button,
  Dialog,
  Field,
  Input,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Text,
  toast,
} from "@glaze/core/components";
import {
  InboxIcon,
  StarIcon,
  SendIcon,
  FileIcon,
  BookmarkIcon,
  TagIcon,
  SettingsIcon,
  PlusIcon,
  ChevronDownIcon,
  LayersIcon,
} from "lucide-react";
import {
  useAccounts,
  useLabels,
  useAddAccount,
  useCreateLabel,
  useViewUnreadCounts,
  useGlobalSyncStatus,
} from "./hooks";
import type { GmailLabel, MailView } from "./types";
import { gmailApi } from "./api";
import { COMBINED_ACCOUNT_ID, useMailViews } from "./custom-views";
import { buildLabelTree, type LabelTreeNode } from "./label-tree";
import { getAccountColor, getAccountDisplayName } from "./account-style";

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: React.ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-4" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-4" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-4" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-4" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-4" /> },
};

// Gmail's own label icon is a solid filled tag — colored per label when Gmail
// has a color set, otherwise a neutral solid tag (via the design system's
// automatic solid rendering for semantic gray on icons).
function labelIcon(label?: GmailLabel): React.ReactNode {
  const color = label?.color?.backgroundColor;
  if (color) {
    return <TagIcon className="size-4 shrink-0 fill-current" style={{ color }} />;
  }
  return <TagIcon className="size-4 shrink-0 text-tertiary" />;
}

function viewIcon(view: MailView): React.ReactNode {
  if (view.kind === "inbox") return <InboxIcon className="size-4 shrink-0" />;
  if (view.kind === "starred") return <StarIcon className="size-4 shrink-0" />;
  if (view.kind === "sent") return <SendIcon className="size-4 shrink-0" />;
  if (view.kind === "drafts") return <FileIcon className="size-4 shrink-0" />;
  return <LayersIcon className="size-4 shrink-0 text-tertiary" />;
}

function CombinedViewRow({
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
}): React.ReactNode {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SidebarListItem
          selected={selected}
          className="group hover:bg-control-subtle"
          onClick={() => {
            console.log("[AccountsSidebar:selectView]", { viewId: view.id });
            onSelect();
          }}
        >
          {viewIcon(view)}
          <SidebarListItemContent>
            <SidebarListItemTitle className={unreadCount > 0 ? "text-strong" : undefined}>
              {view.name}
            </SidebarListItemTitle>
          </SidebarListItemContent>
          <SidebarListItemAccessory>
            {unreadCount > 0 ? unreadCount : null}
            <button
              type="button"
              aria-label={`Edit ${view.name}`}
              className="text-tertiary hover:text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <SettingsIcon className="size-3.5" />
            </button>
          </SidebarListItemAccessory>
        </SidebarListItem>
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

function renderLabelTreeNode(
  node: LabelTreeNode,
  selectedLabelId: string,
  onSelectLabel: (labelId: string) => void,
): React.ReactNode {
  const { label, children } = node;
  const unreadCount = label?.unread && label.unread > 0 ? label.unread : undefined;
  const handleSelect = label
    ? () => {
        console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
        onSelectLabel(label.id);
      }
    : undefined;

  if (children.length === 0) {
    // Props mode (not children mode): only it auto-reserves the chevron gutter,
    // so leaf icons line up in one column with collapsible parents, like Gmail.
    return (
      <SidebarListItem
        key={node.key}
        selected={label ? selectedLabelId === label.id : false}
        className="hover:bg-control-subtle"
        onClick={handleSelect}
        icon={labelIcon(label)}
        title={unreadCount ? <span className="text-strong">{node.segment}</span> : node.segment}
        accessory={unreadCount}
      />
    );
  }

  return (
    <SidebarListItem
      key={node.key}
      collapsible
      defaultOpen={false}
      selected={label ? selectedLabelId === label.id : false}
      className="hover:bg-control-subtle"
      onClick={handleSelect}
      icon={labelIcon(label)}
      title={node.segment}
      accessory={unreadCount}
    >
      {children.map((child) => renderLabelTreeNode(child, selectedLabelId, onSelectLabel))}
    </SidebarListItem>
  );
}

type AccountsSidebarProps = {
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  views: MailView[];
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function AccountsSidebar({
  selectedAccountId,
  onSelectAccount,
  selectedLabelId,
  onSelectLabel,
  views,
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
  const viewUnreadCounts = useViewUnreadCounts(views, accounts, isCombined);
  const globalSync = useGlobalSyncStatus(accounts.map((a) => a.id));
  const { deleteView, resetView } = useMailViews();

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  const systemLabels = labels.filter(
    (l) => l.type === "system" && l.id in SYSTEM_LABEL_MAP,
  );
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

  const handleOpenSettings = () => {
    console.log("[AccountsSidebar:openSettings]");
    void window.glazeAPI.glaze.ipc.invoke("window:openSettings");
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

  return (
    <Sidebar
      footer={
        <SidebarFooter>
          <div className="flex w-full items-center justify-between gap-2">
            {globalSync.syncing ? (
              <div className="flex min-w-0 items-center gap-1.5 px-1">
                <span className="size-3 shrink-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <Text variant="mini" color="tertiary" truncate>
                  {globalSync.label}
                </Text>
              </div>
            ) : (
              <span />
            )}
            <Button
              variant="transparent"
              size="small"
              iconOnly
              onClick={handleOpenSettings}
              aria-label="Open Settings"
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </SidebarFooter>
      }
    >
      {/* Account switcher */}
      <div className="px-3 pt-2 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 w-full rounded-control px-2 py-1.5 hover:bg-control-subtle min-w-0"
              aria-label="Switch account"
            >
              {isCombined ? (
                <div className="size-6 shrink-0 rounded-full bg-control flex items-center justify-center">
                  <LayersIcon className="size-3.5 text-secondary" />
                </div>
              ) : (
                <Avatar size="small">
                  {selectedAccount?.picture ? (
                    <AvatarImage
                      src={selectedAccount.picture}
                      alt={getAccountDisplayName(selectedAccount)}
                    />
                  ) : null}
                  <AvatarFallback>
                    {selectedAccount ? getInitials(getAccountDisplayName(selectedAccount)) : "?"}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <Text variant="small-strong" truncate>
                  {isCombined ? "Combined" : (selectedAccount ? getAccountDisplayName(selectedAccount) : "No account")}
                </Text>
                <Text variant="mini" color="secondary" truncate>
                  {isCombined ? "All mailboxes" : (selectedAccount?.email ?? "")}
                </Text>
              </div>
              <ChevronDownIcon className="size-3.5 shrink-0 text-tertiary" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {accounts.length > 1 ? (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    console.log("[AccountsSidebar:selectAccount]", { accountId: COMBINED_ACCOUNT_ID });
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
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: getAccountColor(account) }}
                  />
                  <span className="truncate">{account.email}</span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void gmailApi.openSettings({ pane: "accounts" })}
            >
              Manage accounts…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isCombined ? (
        <SidebarList>
          {/* Built-in default views (Inbox, Sent) — editable + resettable */}
          {views
            .filter((v) => v.kind !== "custom")
            .map((view) => (
              <CombinedViewRow
                key={view.id}
                view={view}
                selected={selectedLabelId === view.id}
                unreadCount={viewUnreadCounts[view.id] ?? 0}
                onSelect={() => onSelectLabel(view.id)}
                onDelete={() => void deleteView(view.id)}
                onReset={() => void resetView(view.id)}
                onEdit={() => {
                  void gmailApi.openSettings({ pane: "views", viewId: view.id });
                }}
              />
            ))}

          {/* Custom views */}
          <SidebarListGroup
            title="Views"
            collapsible
            defaultOpen
            actions={
              <Button
                iconOnly
                variant="transparent"
                size="small"
                aria-label="New view"
                onClick={() => {
                  void gmailApi.openSettings({ pane: "views", viewId: "new" });
                }}
              >
                <PlusIcon className="size-3.5" />
              </Button>
            }
          >
            {views.filter((v) => v.kind === "custom").length === 0 ? (
              <div className="px-3 py-1.5">
                <Text variant="mini" color="tertiary">
                  Tap + to build a view from any labels across your accounts.
                </Text>
              </div>
            ) : (
              views
                .filter((v) => v.kind === "custom")
                .map((view) => (
                  <CombinedViewRow
                    key={view.id}
                    view={view}
                    selected={selectedLabelId === view.id}
                    unreadCount={viewUnreadCounts[view.id] ?? 0}
                    onSelect={() => onSelectLabel(view.id)}
                    onDelete={() => void deleteView(view.id)}
                    onReset={() => void resetView(view.id)}
                    onEdit={() => {
                      void gmailApi.openSettings({ pane: "views", viewId: view.id });
                    }}
                  />
                ))
            )}
          </SidebarListGroup>
        </SidebarList>
      ) : (
      <SidebarList>
        {/* System labels */}
        {systemLabels.length > 0 ? (
          systemLabels.map((label) => {
            const meta = SYSTEM_LABEL_MAP[label.id];
            if (!meta) return null;
            return (
              <SidebarListItem
                key={label.id}
                selected={selectedLabelId === label.id}
                className="hover:bg-control-subtle"
                onClick={() => {
                  console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
                  onSelectLabel(label.id);
                }}
                icon={meta.icon}
                title={meta.name}
                accessory={
                  label.unread && label.unread > 0 ? label.unread : undefined
                }
              />
            );
          })
        ) : (
          <>
            {Object.entries(SYSTEM_LABEL_MAP).map(([id, meta]) => (
              <SidebarListItem
                key={id}
                selected={selectedLabelId === id}
                className="hover:bg-control-subtle"
                onClick={() => {
                  console.log("[AccountsSidebar:selectLabel]", { labelId: id });
                  onSelectLabel(id);
                }}
                icon={meta.icon}
                title={meta.name}
              />
            ))}
          </>
        )}

        {/* User labels (rendered as a tree — Gmail nests labels via "/" in the name) */}
        {selectedAccountId ? (
          <SidebarListGroup
            title="Labels"
            collapsible
            defaultOpen
            actions={
              <Button
                iconOnly
                variant="transparent"
                size="small"
                aria-label="New label"
                onClick={() => setCreateLabelOpen(true)}
              >
                <PlusIcon className="size-3.5" />
              </Button>
            }
          >
            {userLabelTree.map((node) => renderLabelTreeNode(node, selectedLabelId, onSelectLabel))}
          </SidebarListGroup>
        ) : null}

        {/* Add account fallback if no accounts */}
        {accounts.length === 0 ? (
          <SidebarListItem
            icon={<PlusIcon className="size-4" />}
            title="Add Gmail account"
            className="hover:bg-control-subtle"
            onClick={() => void handleAddAccount()}
          />
        ) : null}
      </SidebarList>
      )}

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
    </Sidebar>
  );
}
