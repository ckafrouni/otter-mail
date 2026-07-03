import { useEffect, useState } from "react";
import { SplitView, EmptyState, Button } from "@glaze/core/components";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { ComposeDialog } from "./gmail/compose-dialog";
import { CommandPalette } from "./gmail/command-palette";
import { useCredentials, useAccounts, useAddAccount, useAccountSync } from "./gmail/hooks";
import type { GmailMessageSummary } from "./gmail/types";
import {
  useMailViews,
  resolveRules,
  loadLastLocation,
  saveLastLocation,
  COMBINED_ACCOUNT_ID,
  INBOX_VIEW_ID,
} from "./gmail/custom-views";

export function HomeView() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // Account that owns the currently-open message (differs per row in combined views).
  const [readerAccountId, setReaderAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
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

  // If the selected combined view disappears (deleted), fall back to Inbox.
  useEffect(() => {
    if (!isCombined) return;
    if (!views.some((v) => v.id === selectedLabelId)) {
      setSelectedLabelId(INBOX_VIEW_ID);
    }
  }, [isCombined, views, selectedLabelId]);

  const effectiveAccountId = isCombined
    ? COMBINED_ACCOUNT_ID
    : selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : firstRealAccountId;

  // Local-first: keep the on-disk cache synced in the background. Combined mode
  // refreshes all accounts via its own list handler (sentinel isn't a real account).
  const syncStatus = useAccountSync(isCombined ? null : effectiveAccountId);

  // Resolve the selected combined view to concrete per-account rules.
  const combined = (() => {
    if (!isCombined) return null;
    const view = views.find((v) => v.id === selectedLabelId) ?? views[0];
    return {
      viewId: view?.id ?? INBOX_VIEW_ID,
      name: view?.name ?? "Inbox",
      rules: view ? resolveRules(view, accounts) : [],
    };
  })();

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    setSelectedAccountId(accountId);
    setSelectedLabelId(accountId === COMBINED_ACCOUNT_ID ? INBOX_VIEW_ID : "INBOX");
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
          />
        }
        sidebarSize={{ default: 220, min: 180, max: 300 }}
        list={
          hasListTarget ? (
            <MessageList
              accountId={(isCombined ? firstRealAccountId : effectiveAccountId) ?? ""}
              labelId={selectedLabelId}
              combined={combined}
              accountIds={accountIds}
              accounts={accounts}
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
