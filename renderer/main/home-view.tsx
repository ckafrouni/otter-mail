import { useState } from "react";
import { SplitView, EmptyState, Button } from "@glaze/core/components";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { ComposeDialog } from "./gmail/compose-dialog";
import { useCredentials, useAccounts, useAddAccount, useAccountSync } from "./gmail/hooks";

export function HomeView() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  const credentialsQuery = useCredentials();
  const accountsQuery = useAccounts();
  const addAccount = useAddAccount();

  const accounts = accountsQuery.data ?? [];
  const credentials = credentialsQuery.data;

  // Resolve the effective account: use selected if still present, else first available
  const effectiveAccountId =
    selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : (accounts[0]?.id ?? null);

  // Local-first: keep the on-disk cache synced with Gmail in the background
  // and refresh views as it fills in.
  const syncStatus = useAccountSync(effectiveAccountId);

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    setSelectedAccountId(accountId);
    setSelectedMessageId(null);
    setSearchQuery("");
  };

  const handleSelectLabel = (labelId: string) => {
    console.log("[HomeView:selectLabel]", { labelId });
    setSelectedLabelId(labelId);
    setSelectedMessageId(null);
    setSearchQuery("");
  };

  const handleSelectMessage = (messageId: string) => {
    console.log("[HomeView:selectMessage]", { messageId });
    setSelectedMessageId(messageId);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setSelectedMessageId(null);
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
    } catch {
      // error surfaced by mutation
    }
  };

  // (a) Loading credentials
  if (credentialsQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // (a) No credentials configured
  if (!credentials?.hasCredentials) {
    return (
      <div className="h-full flex items-center justify-center">
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
      <div className="h-full flex items-center justify-center">
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

  // (c) Normal three-pane layout via SplitView
  return (
    <>
      <SplitView
        sidebar={
          <AccountsSidebar
            selectedAccountId={effectiveAccountId}
            onSelectAccount={handleSelectAccount}
            selectedLabelId={selectedLabelId}
            onSelectLabel={handleSelectLabel}
            onCompose={() => setComposeOpen(true)}
          />
        }
        sidebarSize={{ default: 220, min: 180, max: 300 }}
        list={
          effectiveAccountId ? (
            <MessageList
              accountId={effectiveAccountId}
              labelId={selectedLabelId}
              selectedMessageId={selectedMessageId}
              onSelectMessage={handleSelectMessage}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              syncStatus={syncStatus}
            />
          ) : undefined
        }
        listSize={{ default: 440, min: 300, max: 640 }}
        storageKey="gmail-main"
        className="h-full"
      >
        {/* Primary pane */}
        {effectiveAccountId ? (
          <MessageReader
            accountId={effectiveAccountId}
            messageId={selectedMessageId}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="No account selected"
              description="Select an account from the sidebar."
            />
          </div>
        )}
      </SplitView>

      {effectiveAccountId && composeOpen ? (
        <ComposeDialog
          accountId={effectiveAccountId}
          open={composeOpen}
          onOpenChange={setComposeOpen}
        />
      ) : null}
    </>
  );
}
