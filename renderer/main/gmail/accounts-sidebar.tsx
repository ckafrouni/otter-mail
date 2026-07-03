import { useState } from "react";
import type React from "react";
import {
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
  PencilIcon,
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
  useRemoveAccount,
  useCreateLabel,
} from "./hooks";
import type { GmailLabel, LabelSelection, MailView } from "./types";
import { ViewEditorDialog } from "./view-editor-dialog";
import { COMBINED_ACCOUNT_ID } from "./custom-views";

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: React.ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-4" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-4" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-4" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-4" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-4" /> },
};

type LabelTreeNode = {
  key: string;
  segment: string;
  label?: GmailLabel;
  children: LabelTreeNode[];
};

// Gmail nests user labels by "/" in the name (e.g. "99/personal" is a child of "99").
// Build a tree from the flat list so the sidebar can render it with proper disclosure nesting.
function buildLabelTree(labels: GmailLabel[]): LabelTreeNode[] {
  const root: LabelTreeNode[] = [];
  const nodesByPath = new Map<string, LabelTreeNode>();

  for (const label of labels) {
    const parts = label.name.split("/").filter(Boolean);
    let siblings = root;
    let path = "";
    parts.forEach((part, i) => {
      path = path ? `${path}/${part}` : part;
      let node = nodesByPath.get(path);
      if (!node) {
        node = { key: path, segment: part, children: [] };
        nodesByPath.set(path, node);
        siblings.push(node);
      }
      if (i === parts.length - 1) node.label = label;
      siblings = node.children;
    });
  }

  sortLabelTree(root);
  return root;
}

function sortLabelTree(nodes: LabelTreeNode[]): void {
  nodes.sort((a, b) => a.segment.localeCompare(b.segment));
  for (const node of nodes) sortLabelTree(node.children);
}

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
  if (view.kind === "sent") return <SendIcon className="size-4 shrink-0" />;
  return <LayersIcon className="size-4 shrink-0 text-tertiary" />;
}

function CombinedViewRow({
  view,
  selected,
  onSelect,
  onEdit,
}: {
  view: MailView;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}): React.ReactNode {
  return (
    <SidebarListItem
      selected={selected}
      onClick={() => {
        console.log("[AccountsSidebar:selectView]", { viewId: view.id });
        onSelect();
      }}
    >
      {viewIcon(view)}
      <SidebarListItemContent>
        <SidebarListItemTitle>{view.name}</SidebarListItemTitle>
      </SidebarListItemContent>
      <SidebarListItemAccessory>
        <button
          type="button"
          aria-label={`Edit ${view.name}`}
          className="text-tertiary hover:text-primary transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <SettingsIcon className="size-3.5" />
        </button>
      </SidebarListItemAccessory>
    </SidebarListItem>
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
    return (
      <SidebarListItem
        key={node.key}
        selected={label ? selectedLabelId === label.id : false}
        onClick={handleSelect}
      >
        {labelIcon(label)}
        <SidebarListItemContent>
          <SidebarListItemTitle className={unreadCount ? "text-strong" : undefined}>
            {node.segment}
          </SidebarListItemTitle>
        </SidebarListItemContent>
        {unreadCount !== undefined ? (
          <SidebarListItemAccessory>{unreadCount}</SidebarListItemAccessory>
        ) : null}
      </SidebarListItem>
    );
  }

  return (
    <SidebarListItem
      key={node.key}
      collapsible
      defaultOpen={false}
      selected={label ? selectedLabelId === label.id : false}
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
  onCompose: () => void;
  views: MailView[];
  onSaveView: (input: { id?: string; name: string; selections: LabelSelection[] }) => void;
  onDeleteView: (id: string) => void;
  onResetView: (id: string) => void;
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
  onCompose,
  views,
  onSaveView,
  onDeleteView,
  onResetView,
}: AccountsSidebarProps) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const accountsQuery = useAccounts();
  const labelsQuery = useLabels(isCombined ? null : selectedAccountId);
  const addAccount = useAddAccount();
  const removeAccount = useRemoveAccount();
  const createLabel = useCreateLabel();

  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [viewEditorOpen, setViewEditorOpen] = useState(false);
  const [editingView, setEditingView] = useState<MailView | null>(null);

  const accounts = accountsQuery.data ?? [];
  const labels: GmailLabel[] = labelsQuery.data ?? [];

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

  const handleRemoveAccount = async (accountId: string) => {
    console.log("[AccountsSidebar:removeAccount]", { accountId });
    await removeAccount.mutateAsync(accountId);
    if (accountId === selectedAccountId && accounts.length > 1) {
      const next = accounts.find((a) => a.id !== accountId);
      if (next) onSelectAccount(next.id);
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
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={handleOpenSettings}
            aria-label="Open Settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </SidebarFooter>
      }
    >
      {/* Account switcher */}
      <div className="px-3 pt-2 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 w-full rounded-control px-2 py-1.5 hover:bg-control-subtle transition-colors min-w-0"
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
                      alt={selectedAccount.name}
                    />
                  ) : null}
                  <AvatarFallback>
                    {selectedAccount ? getInitials(selectedAccount.name) : "?"}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <Text variant="small-strong" truncate>
                  {isCombined ? "Combined" : (selectedAccount?.name ?? "No account")}
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
                {account.email}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {accounts.map((account) => (
              <DropdownMenuItem
                key={`remove-${account.id}`}
                color="red"
                onSelect={() => void handleRemoveAccount(account.id)}
              >
                Remove {account.email}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon="plus"
              onSelect={() => void handleAddAccount()}
            >
              Add account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Compose button */}
      <div className="px-3 pb-2">
        <Button
          variant="filled"
          size="small"
          className="w-full"
          onClick={onCompose}
        >
          <PencilIcon className="size-4" />
          Compose
        </Button>
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
                onSelect={() => onSelectLabel(view.id)}
                onEdit={() => {
                  setEditingView(view);
                  setViewEditorOpen(true);
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
                  setEditingView(null);
                  setViewEditorOpen(true);
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
                    onSelect={() => onSelectLabel(view.id)}
                    onEdit={() => {
                      setEditingView(view);
                      setViewEditorOpen(true);
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
            onClick={() => void handleAddAccount()}
          />
        ) : null}
      </SidebarList>
      )}

      <ViewEditorDialog
        open={viewEditorOpen}
        onOpenChange={setViewEditorOpen}
        view={editingView}
        accounts={accounts}
        onSave={onSaveView}
        onDelete={onDeleteView}
        onReset={onResetView}
      />

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
