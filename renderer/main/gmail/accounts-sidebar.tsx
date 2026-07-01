import type React from "react";
import {
  Sidebar,
  SidebarList,
  SidebarListItem,
  SidebarListGroup,
  SidebarFooter,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Text,
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
} from "lucide-react";
import { useAccounts, useLabels, useAddAccount, useRemoveAccount } from "./hooks";
import type { GmailLabel } from "./types";

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: React.ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-4" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-4" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-4" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-4" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-4" /> },
};

type AccountsSidebarProps = {
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  onCompose: () => void;
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
}: AccountsSidebarProps) {
  const accountsQuery = useAccounts();
  const labelsQuery = useLabels(selectedAccountId);
  const addAccount = useAddAccount();
  const removeAccount = useRemoveAccount();

  const accounts = accountsQuery.data ?? [];
  const labels: GmailLabel[] = labelsQuery.data ?? [];

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  const systemLabels = labels.filter(
    (l) => l.type === "system" && l.id in SYSTEM_LABEL_MAP,
  );
  const userLabels = labels.filter((l) => l.type === "user");

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
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <Text variant="small-strong" truncate>
                  {selectedAccount?.name ?? "No account"}
                </Text>
                <Text variant="mini" color="secondary" truncate>
                  {selectedAccount?.email ?? ""}
                </Text>
              </div>
              <ChevronDownIcon className="size-3.5 shrink-0 text-tertiary" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
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

        {/* User labels */}
        {userLabels.length > 0 ? (
          <SidebarListGroup title="Labels">
            {userLabels.map((label) => (
              <SidebarListItem
                key={label.id}
                selected={selectedLabelId === label.id}
                onClick={() => {
                  console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
                  onSelectLabel(label.id);
                }}
                icon={<TagIcon className="size-4" />}
                title={label.name}
                accessory={
                  label.unread && label.unread > 0 ? label.unread : undefined
                }
              />
            ))}
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
    </Sidebar>
  );
}
