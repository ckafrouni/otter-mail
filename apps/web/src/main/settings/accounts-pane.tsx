import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import { CheckIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { gmailApi } from "../gmail/api";
import { toast } from "../gmail/toast";
import {
  syncStatusPollMs,
  useAccounts,
  useAddAccount,
  useRemoveAccount,
  useUpdateAccount,
} from "../gmail/hooks";
import { RichTextArea, type RichTextRef } from "../gmail/rich-text";
import {
  ACCOUNT_COLOR_PALETTE,
  getAccountColor,
  getAccountDisplayName,
} from "../gmail/account-style";
import type { GmailAccount, SyncStatus } from "../gmail/types";
import { Btn, HintTooltip, cn, restoreFocusForKeyboardOnly } from "../gmail/ui";
import { DraftInput, SettingsGroup, SettingsRow, SettingsSection } from "./settings-ui";

/**
 * Settings › Accounts, laid out like Settings › Assistant: one card split into
 * the account list (avatar, name, sync state) and the selected account's
 * editor (status, profile, signature, removal).
 */

const CARD_HEIGHT =
  "@min-[48rem]/accounts:h-[min(44rem,calc(100dvh-9rem))] @min-[48rem]/accounts:min-h-[32rem]";

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type StatusLine = { text: string; tone: "muted" | "active" | "error"; detail?: string };

function syncLine(status: SyncStatus | undefined): {
  text: string;
  tone: "muted" | "active" | "error";
  detail?: string;
} {
  if (!status) return { text: "…", tone: "muted" };
  // Only a full sync reads as "Syncing": the routine check for new mail runs
  // every tick and would otherwise blink here all the time.
  if (status.syncing && (status.phase === "full" || !status.lastSyncAt)) {
    const progress =
      status.phase === "full" && status.total
        ? ` ${status.synced.toLocaleString()} of ~${status.total.toLocaleString()}`
        : "";
    return { text: `Syncing${progress}…`, tone: "active" };
  }
  if (status.error && !status.syncing) {
    return { text: "Sync failed — will retry", tone: "error", detail: status.error };
  }
  const synced = status.lastSyncAt ? `Synced ${timeAgo(status.lastSyncAt)}` : "Not synced yet";
  if (status.download) {
    const left = Math.max(0, status.download.total - status.download.done);
    return { text: `${synced} · Saving ${left.toLocaleString()} for offline`, tone: "muted" };
  }
  return { text: synced, tone: "muted" };
}

/** Read-only sync status (the main view starts syncs; settings only watches). */
function useSyncStatusOnly(accountId: string) {
  return useQuery<SyncStatus>({
    queryKey: ["gmail:syncStatus", accountId],
    queryFn: () => gmailApi.getSyncStatus(accountId),
    refetchInterval: (query) => syncStatusPollMs(query.state.data),
  });
}

function ColorPicker({
  color,
  label,
  onPick,
}: {
  color: string;
  label: string;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <HintTooltip label="Account color">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-none transition-colors hover:bg-accent-surface focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span
              className="size-3.5 rounded-full ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: color }}
            />
          </button>
        </Popover.Trigger>
      </HintTooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={restoreFocusForKeyboardOnly}
          className="dropdown-glass z-[130] grid grid-cols-5 gap-1.5 rounded-xl p-2.5 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none"
        >
          {ACCOUNT_COLOR_PALETTE.map((swatch) => {
            const picked = swatch.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Use ${swatch}`}
                onClick={() => {
                  onPick(swatch);
                  setOpen(false);
                }}
                className="flex size-6 cursor-pointer items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-focus-ring"
                style={{ backgroundColor: swatch }}
              >
                {picked ? <CheckIcon className="size-3.5 text-white" strokeWidth={3} /> : null}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Sync state for an account, with a signed-out account called out first. */
function accountStatus(account: GmailAccount, status: SyncStatus | undefined): StatusLine {
  if (account.signedOut) {
    return {
      text: "Signed out",
      tone: "error",
      detail: "Sign in again to sync this account. Its cached mail stays.",
    };
  }
  return syncLine(status);
}

function StatusText({ status, className }: { status: StatusLine; className?: string }) {
  return (
    <span
      title={status.detail}
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        status.tone === "error" && "text-destructive-foreground",
        status.tone === "active" && "text-foreground/80",
        className,
      )}
    >
      {status.tone !== "muted" ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.tone === "error" ? "bg-destructive" : "bg-primary",
          )}
        />
      ) : null}
      <span className="truncate">{status.text}</span>
    </span>
  );
}

function AccountAvatar({ account, size = "small" }: { account: GmailAccount; size?: "small" }) {
  const displayName = getAccountDisplayName(account);
  return (
    <span className="relative shrink-0">
      <Avatar size={size}>
        {account.picture ? <AvatarImage src={account.picture} alt={displayName} /> : null}
        <AvatarFallback>{(displayName[0] ?? "?").toUpperCase()}</AvatarFallback>
      </Avatar>
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card"
        style={{ backgroundColor: getAccountColor(account) }}
      />
    </span>
  );
}

/** Sign in again (signed-out account) or add a new one; cancellable while Google is open. */
function SignInButton({ email, label }: { email?: string; label: string }) {
  const signIn = useAddAccount();
  if (signIn.isPending) {
    return (
      <Btn size="xs" onClick={() => void gmailApi.cancelAddAccount()}>
        Cancel sign-in
      </Btn>
    );
  }
  return (
    <Btn
      size="xs"
      variant={email ? "primary" : "outline"}
      onClick={() =>
        void signIn.mutateAsync(email).catch((err: unknown) => {
          toast.error(email ? `Couldn't sign in to ${email}` : "Couldn't add the account", {
            description: err instanceof Error ? err.message : String(err),
          });
        })
      }
    >
      {email ? null : <PlusIcon className="size-3.5" />}
      {label}
    </Btn>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function AccountListRow({
  account,
  selected,
  onSelect,
}: {
  account: GmailAccount;
  selected: boolean;
  onSelect: () => void;
}) {
  const sync = useSyncStatusOnly(account.id);
  const status = accountStatus(account, sync.data);
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "relative flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        onClick={onSelect}
        aria-label={`Select ${account.email}`}
        aria-pressed={selected}
      />
      <AccountAvatar account={account} />
      <span className="pointer-events-none min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {getAccountDisplayName(account)}
        </span>
        <span className="block truncate text-xs text-muted-foreground/80">{account.email}</span>
        <StatusText status={status} className="mt-0.5 text-xs text-muted-foreground/80" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function AccountEditor({ account }: { account: GmailAccount }) {
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const sync = useSyncStatusOnly(account.id);
  const displayName = getAccountDisplayName(account);
  const status = accountStatus(account, sync.data);
  const signatureRef = useRef<RichTextRef>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const syncNow = () => {
    setSyncing(true);
    void gmailApi
      .syncAccount(account.id)
      .catch(() => {})
      .finally(() => setTimeout(() => setSyncing(false), 700));
  };

  const saveSignature = () => {
    const editor = signatureRef.current;
    if (!editor) return;
    const html = editor.getText().trim().length === 0 ? "" : editor.getHTML();
    if (html === (account.signature ?? "")) return;
    console.log("[Settings:updateSignature]", { accountId: account.id });
    void updateAccount
      .mutateAsync({ accountId: account.id, signature: html })
      .then(() => toast.success("Signature saved"));
  };

  return (
    <>
      <SettingsSection
        title={displayName}
        icon={<AccountAvatar account={account} />}
        headerAction={<span className="text-xs text-muted-foreground">{account.email}</span>}
      >
        <SettingsRow
          title="Status"
          status={<StatusText status={status} className="text-xs text-muted-foreground" />}
          control={
            account.signedOut ? (
              <SignInButton email={account.email} label="Sign in" />
            ) : (
              <Btn size="sm" disabled={syncing || sync.data?.syncing} onClick={syncNow}>
                <RotateCwIcon
                  className={cn("size-3.5", (syncing || sync.data?.syncing) && "animate-spin")}
                />
                Sync now
              </Btn>
            )
          }
        />
      </SettingsSection>

      <SettingsSection title="Profile">
        <SettingsRow
          title="Display name"
          description="Shown in the sidebar and account switcher. Only used in Otter Mail."
          control={
            <DraftInput
              value={displayName}
              onCommit={(name) => {
                if (!name) return;
                console.log("[Settings:renameAccount]", { accountId: account.id, name });
                void updateAccount.mutateAsync({ accountId: account.id, displayName: name });
              }}
              aria-label={`Display name for ${account.email}`}
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="Color"
          description="Marks this account's mail in combined mailboxes."
          control={
            <ColorPicker
              color={getAccountColor(account)}
              label={`Color for ${account.email}`}
              onPick={(swatch) =>
                void updateAccount.mutateAsync({ accountId: account.id, color: swatch })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Signature"
        headerAction={
          <Btn size="xs" variant="primary" onClick={saveSignature}>
            Save signature
          </Btn>
        }
      >
        <div className="p-3 sm:p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Added to new messages, replies and forwards from this account.
          </p>
          <div className="rounded-lg border border-input bg-canvas dark:bg-input/32">
            <RichTextArea
              key={account.id}
              ref={signatureRef}
              placeholder="Your signature…"
              ariaLabel={`Signature for ${account.email}`}
              minHeightClass="min-h-[96px]"
              initialHTML={account.signature}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Remove">
        <SettingsRow
          title="Remove account"
          description="Stops syncing and deletes the local copy. Nothing is deleted from Gmail."
          control={
            <Btn size="sm" variant="destructive" onClick={() => setConfirmRemove(true)}>
              Remove…
            </Btn>
          }
        />
      </SettingsSection>

      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${displayName}?`}
        confirmLabel={removeAccount.isPending ? "Removing…" : "Remove account"}
        confirmVariant="accent"
        onConfirm={() => {
          console.log("[Settings:removeAccount]", { accountId: account.id });
          void removeAccount.mutateAsync(account.id).then(() => setConfirmRemove(false));
        }}
      >
        <Text variant="small">
          Otter Mail stops syncing {account.email} and deletes its local copy. Nothing is deleted
          from Gmail — you can add the account again any time.
        </Text>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

export function AccountsPane() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container/accounts mx-auto w-full max-w-5xl space-y-2.5 px-4 pb-16 pt-4 sm:px-6">
        <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 sm:px-4">
          <h2 className="text-sm font-normal text-foreground/70">Accounts</h2>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            {accounts.length > 0 ? (
              <span className="text-2xs text-muted-foreground">
                {accounts.length} account{accounts.length === 1 ? "" : "s"}
              </span>
            ) : null}
            <SignInButton label="Add account" />
          </div>
        </div>

        {current ? (
          <SettingsGroup
            divided={false}
            className={cn(
              CARD_HEIGHT,
              "overflow-hidden @min-[48rem]/accounts:grid @min-[48rem]/accounts:grid-cols-[17rem_minmax(0,1fr)]",
            )}
          >
            <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/accounts:flex @min-[48rem]/accounts:min-h-0 @min-[48rem]/accounts:flex-col @min-[48rem]/accounts:border-r @min-[48rem]/accounts:border-b-0">
              <div className="divide-y divide-border/50 @min-[48rem]/accounts:min-h-0 @min-[48rem]/accounts:flex-1 @min-[48rem]/accounts:overflow-y-auto">
                {accounts.map((account) => (
                  <AccountListRow
                    key={account.id}
                    account={account}
                    selected={account.id === current.id}
                    onSelect={() => setSelectedId(account.id)}
                  />
                ))}
              </div>
            </div>
            <div className="min-w-0 @min-[48rem]/accounts:min-h-0 @min-[48rem]/accounts:overflow-y-auto">
              <div className="space-y-6 p-4">
                <AccountEditor key={current.id} account={current} />
              </div>
            </div>
          </SettingsGroup>
        ) : (
          <SettingsGroup>
            <SettingsRow
              title={accountsQuery.isLoading ? "Loading accounts…" : "No accounts yet"}
              description="Add a Gmail account to start syncing mail. You'll sign in with Google in your browser."
            />
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}
