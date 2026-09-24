import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage, Dialog, Text } from "@glaze/core/components";
import { CheckIcon, EllipsisIcon, PenLineIcon, PlusIcon, Trash2Icon, TypeIcon } from "lucide-react";
import { gmailApi } from "../gmail/api";
import { useAccounts, useAddAccount, useRemoveAccount, useUpdateAccount } from "../gmail/hooks";
import { RichTextArea, type RichTextRef } from "../gmail/rich-text";
import {
  ACCOUNT_COLOR_PALETTE,
  getAccountColor,
  getAccountDisplayName,
} from "../gmail/account-style";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../gmail/menu";
import type { GmailAccount, SyncStatus } from "../gmail/types";
import { Btn, HintTooltip, IconBtn, cn, restoreFocusForKeyboardOnly } from "../gmail/ui";
import { SettingsPageContainer, SettingsRow, SettingsSection, TextInput } from "./settings-ui";

/**
 * Settings › Accounts: one card row per Gmail account. The name edits in
 * place, the color comes from a small palette, sync state is at a glance, and
 * the signature and removal live behind the row's menu.
 */

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function syncLine(status: SyncStatus | undefined): {
  text: string;
  tone: "muted" | "active" | "error";
} {
  if (!status) return { text: "…", tone: "muted" };
  if (status.error) return { text: "Sync failed — will retry", tone: "error" };
  if (status.syncing) {
    const progress =
      status.phase === "full" && status.total
        ? ` ${status.synced.toLocaleString()} of ~${status.total.toLocaleString()}`
        : "";
    return { text: `Syncing${progress}…`, tone: "active" };
  }
  return status.lastSyncAt
    ? { text: `Synced ${timeAgo(status.lastSyncAt)}`, tone: "muted" }
    : { text: "Not synced yet", tone: "muted" };
}

/** Read-only sync status (the main view starts syncs; settings only watches). */
function useSyncStatusOnly(accountId: string) {
  return useQuery<SyncStatus>({
    queryKey: ["gmail:syncStatus", accountId],
    queryFn: () => gmailApi.getSyncStatus(accountId),
    refetchInterval: (query) => (query.state.data?.syncing ? 1500 : 10_000),
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

/** Plain-text preview of a signature's first line. */
function signaturePreview(html: string | undefined): string {
  if (!html) return "";
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

function AccountRow({ account }: { account: GmailAccount }) {
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const sync = useSyncStatusOnly(account.id);
  const displayName = getAccountDisplayName(account);
  const color = getAccountColor(account);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(displayName);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const signatureRef = useRef<RichTextRef>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(displayName), [displayName]);
  useEffect(() => {
    if (renaming) nameRef.current?.select();
  }, [renaming]);

  const commitName = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === displayName) {
      setName(displayName);
      return;
    }
    console.log("[Settings:renameAccount]", { accountId: account.id, name: trimmed });
    void updateAccount.mutateAsync({ accountId: account.id, displayName: trimmed });
  };

  const saveSignature = () => {
    const editor = signatureRef.current;
    setSignatureOpen(false);
    if (!editor) return;
    const html = editor.getText().trim().length === 0 ? "" : editor.getHTML();
    if (html === (account.signature ?? "")) return;
    console.log("[Settings:updateSignature]", { accountId: account.id });
    void updateAccount.mutateAsync({ accountId: account.id, signature: html });
  };

  const status = syncLine(sync.data);
  const preview = signaturePreview(account.signature);

  return (
    <div data-slot="settings-row" className="group/row">
      <SettingsRow
        className="rounded-none"
        title={
          <span className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <Avatar size="small">
                {account.picture ? <AvatarImage src={account.picture} alt={displayName} /> : null}
                <AvatarFallback>{(displayName[0] ?? "?").toUpperCase()}</AvatarFallback>
              </Avatar>
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card"
                style={{ backgroundColor: color }}
              />
            </span>
            <span className="flex min-w-0 flex-col">
              {renaming ? (
                <TextInput
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      commitName();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setName(displayName);
                      setRenaming(false);
                    }
                  }}
                  aria-label={`Display name for ${account.email}`}
                  className="h-6 w-48 px-1.5 text-sm font-medium"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="group/name -mx-1 inline-flex w-fit max-w-full cursor-text items-center gap-1.5 rounded-sm px-1 text-left outline-none hover:bg-accent-surface/60 focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <span className="truncate">{displayName}</span>
                  <PenLineIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
                </button>
              )}
              <span className="truncate text-xs font-normal text-muted-foreground/80">
                {account.email}
                <span className="px-1.5 text-muted-foreground/40">·</span>
                <span
                  className={cn(
                    status.tone === "error" && "text-destructive-foreground",
                    status.tone === "active" && "text-foreground/80",
                  )}
                >
                  {status.text}
                </span>
              </span>
            </span>
          </span>
        }
        control={
          <div className="flex items-center gap-1">
            <ColorPicker
              color={color}
              label={`Color for ${account.email}`}
              onPick={(swatch) =>
                void updateAccount.mutateAsync({ accountId: account.id, color: swatch })
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconBtn label={`More for ${account.email}`}>
                  <EllipsisIcon className="size-4" />
                </IconBtn>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<TypeIcon />} onSelect={() => setRenaming(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem icon={<PenLineIcon />} onSelect={() => setSignatureOpen(true)}>
                  {account.signature ? "Edit signature" : "Add signature"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  color="red"
                  icon={<Trash2Icon />}
                  onSelect={() => setConfirmRemove(true)}
                >
                  Remove account…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {/* Signature sub-row: preview at rest, the editor when open. */}
      <div className="px-3 pb-3 sm:px-4">
        {signatureOpen ? (
          <div className="ms-11 space-y-2">
            <div className="rounded-lg border border-input bg-canvas dark:bg-input/32">
              <RichTextArea
                ref={signatureRef}
                placeholder="Your signature…"
                ariaLabel={`Signature for ${account.email}`}
                minHeightClass="min-h-[80px]"
                initialHTML={account.signature}
              />
            </div>
            <div className="flex justify-end gap-1.5">
              <Btn size="xs" variant="ghost" onClick={() => setSignatureOpen(false)}>
                Cancel
              </Btn>
              <Btn size="xs" variant="primary" onClick={saveSignature}>
                Save signature
              </Btn>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSignatureOpen(true)}
            className="ms-11 flex max-w-[calc(100%-2.75rem)] cursor-pointer items-center gap-2 rounded-md py-1 text-left text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <PenLineIcon className="size-3 shrink-0 text-muted-foreground" />
            {preview ? (
              <span className="truncate text-muted-foreground">
                <span className="text-muted-foreground/70">Signature · </span>
                {preview}
              </span>
            ) : (
              <span className="text-muted-foreground">Add a signature</span>
            )}
          </button>
        )}
      </div>

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
    </div>
  );
}

export function AccountsPane() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const addAccount = useAddAccount();
  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Accounts"
        headerAction={
          <div className="flex items-center gap-2">
            {accounts.length > 0 ? (
              <span className="text-2xs text-muted-foreground">
                {accounts.length} account{accounts.length === 1 ? "" : "s"}
              </span>
            ) : null}
            <Btn
              size="xs"
              variant="outline"
              disabled={addAccount.isPending}
              onClick={() => void addAccount.mutateAsync().catch(() => {})}
            >
              <PlusIcon className="size-3.5" />
              {addAccount.isPending ? "Waiting for Google…" : "Add account"}
            </Btn>
          </div>
        }
      >
        {accounts.length > 0 ? (
          accounts.map((account) => <AccountRow key={account.id} account={account} />)
        ) : (
          <SettingsRow
            title="No accounts yet"
            description="Add a Gmail account to start syncing mail. You'll sign in with Google in your browser."
          />
        )}
      </SettingsSection>
      <p className="px-3 text-xs text-muted-foreground/80 sm:px-4">
        Names and colors are only used in Otter Mail. Signatures are added to new messages, replies
        and forwards from that account.
      </p>
    </SettingsPageContainer>
  );
}
