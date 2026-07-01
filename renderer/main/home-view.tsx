import { useState } from "react";
import { SplitView, EmptyState, Button } from "@glaze/core/components";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { ComposeDialog } from "./gmail/compose-dialog";
import { useCredentials, useAccounts, useAddAccount, useAccountSync } from "./gmail/hooks";
import type { CombinedQuery } from "./gmail/hooks";
import {
  useCustomViews,
  COMBINED_ACCOUNT_ID,
  COMBINED_INBOX_LABEL,
  VIEW_LABEL_PREFIX,
} from "./gmail/custom-views";

export function HomeView() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // Account that owns the currently-open message (differs per row in combined views).
  const [readerAccountId, setReaderAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  const credentialsQuery = useCredentials();
  const accountsQuery = useAccounts();
  const addAccount = useAddAccount();
  const { views, saveView, deleteView } = useCustomViews();

  const accounts = accountsQuery.data ?? [];
  const credentials = credentialsQuery.data;
  const accountIds = accounts.map((a) => a.id);
  const firstRealAccountId = accounts[0]?.id ?? null;

  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  // Resolve the effective account: combined sentinel, else selected if present, else first.
  const effectiveAccountId = isCombined
    ? COMBINED_ACCOUNT_ID
    : selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : firstRealAccountId;

  // Local-first: keep the on-disk cache synced with Gmail in the background.
  // Combined mode refreshes all accounts via its own list handler, so skip the
  // per-account driver here (the sentinel isn't a real account).
  const syncStatus = useAccountSync(isCombined ? null : effectiveAccountId);

  // Build the cross-account query for the Combined mailbox.
  const combinedQuery: CombinedQuery | null = (() => {
    if (!isCombined) return null;
    if (selectedLabelId.startsWith(VIEW_LABEL_PREFIX)) {
      const viewId = selectedLabelId.slice(VIEW_LABEL_PREFIX.length);
      const view = views.find((v) => v.id === viewId);
      return { kind: "view", viewId, labelNames: view?.labelNames ?? [] };
    }
    return { kind: "inbox" };
  })();

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    setSelectedAccountId(accountId);
    setSelectedLabelId(accountId === COMBINED_ACCOUNT_ID ? COMBINED_INBOX_LABEL : "INBOX");
    setSelectedMessageId(null);
    setReaderAccountId(null);
    setSearchQuery("");
  };

  const handleSelectLabel = (labelId: string) => {
    console.log("[HomeView:selectLabel]", { labelId });
    setSelectedLabelId(labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
    setSearchQuery("");
  };

  const handleSelectMessage = (messageId: string, accountId: string) => {
    console.log("[HomeView:selectMessage]", { messageId, accountId });
    setSelectedMessageId(messageId);
    setReaderAccountId(accountId);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setSelectedMessageId(null);
    setReaderAccountId(null);
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

  const composeAccountId = isCombined ? firstRealAccountId : effectiveAccountId;
  const readerAccount = readerAccountId ?? (isCombined ? firstRealAccountId : effectiveAccountId);
  const hasListTarget = isCombined || effectiveAccountId != null;

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
            views={views}
            onSaveView={saveView}
            onDeleteView={deleteView}
          />
        }
        sidebarSize={{ default: 220, min: 180, max: 300 }}
        list={
          hasListTarget ? (
            <MessageList
              accountId={(isCombined ? firstRealAccountId : effectiveAccountId) ?? ""}
              labelId={selectedLabelId}
              combined={combinedQuery}
              accountIds={accountIds}
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
        {readerAccount ? (
          <MessageReader accountId={readerAccount} messageId={selectedMessageId} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="No account selected"
              description="Select an account from the sidebar."
            />
          </div>
        )}
      </SplitView>

      {composeAccountId && composeOpen ? (
        <ComposeDialog
          accountId={composeAccountId}
          open={composeOpen}
          onOpenChange={setComposeOpen}
        />
      ) : null}
    </>
  );
}
