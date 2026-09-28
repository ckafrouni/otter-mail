import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OtterAccountState, OtterDevice } from "@otter-mail/contracts";
import { ChevronDownIcon, LaptopIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import { useAccounts } from "../gmail/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../gmail/menu";
import { toast } from "../gmail/toast";
import { Btn, cn } from "../gmail/ui";
import { otterApi, useOtterAccount } from "../otter-account";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-ui";

/**
 * Settings › Otter account, opened from the user button at the bottom of the
 * settings sidebar (as in Otter Code): who is signed in, whether mail arrives
 * by push, the Macs signed in, sign-out and deletion. Signed out, it explains
 * the account and signs in.
 */

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function OtterAvatar({
  user,
  className,
}: {
  user: NonNullable<OtterAccountState["user"]>;
  className?: string;
}) {
  return (
    <Avatar size="small" className={className}>
      {user.picture ? <AvatarImage src={user.picture} alt={user.email} /> : null}
      <AvatarFallback>{(user.name ?? user.email)[0]?.toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** Signs in as one of this Mac's accounts (no browser), or with Google in the browser. */
function SignInControl() {
  const accounts = (useAccounts().data ?? []).filter((account) => !account.signedOut);
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);

  const signIn = (accountId?: string) => {
    if (!accountId) setWaitingForBrowser(true);
    otterApi
      .signIn(accountId)
      .catch((err: unknown) => {
        toast.error("Couldn't sign in to Otter Mail", { description: errorText(err) });
      })
      .finally(() => setWaitingForBrowser(false));
  };

  if (waitingForBrowser) {
    return (
      <Btn size="sm" onClick={() => void otterApi.cancelSignIn()}>
        Cancel sign-in
      </Btn>
    );
  }
  if (accounts.length === 0) {
    return (
      <Btn size="sm" variant="primary" onClick={() => signIn()}>
        Sign in with Google
      </Btn>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Btn size="sm" variant="primary">
          Sign in
          <ChevronDownIcon className="size-3.5" />
        </Btn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {accounts.map((account) => (
          <DropdownMenuItem key={account.id} onSelect={() => signIn(account.id)}>
            Continue as {account.email}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signIn()}>Another Google account…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const REALTIME_STATUS = {
  live: { text: "Connected: new mail arrives as it lands", dot: "bg-primary" },
  connecting: { text: "Connecting…", dot: "bg-muted-foreground/60" },
  off: { text: "Not connected", dot: "bg-muted-foreground/60" },
} as const;

function DevicesSection() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["otter:devices"], queryFn: otterApi.listDevices });
  const signOutDevice = useMutation({
    mutationFn: (device: OtterDevice) => otterApi.signOutDevice(device.token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["otter:devices"] }),
    onError: (err) => toast.error("Couldn't sign that Mac out", { description: errorText(err) }),
  });

  return (
    <SettingsSection title="Devices">
      {devices.isError ? (
        <SettingsRow title="Couldn't load your devices" description={errorText(devices.error)} />
      ) : !devices.data ? (
        <SettingsRow title="Loading devices…" />
      ) : (
        devices.data.map((device) => (
          <SettingsRow
            key={device.token}
            title={
              <span className="flex items-center gap-2">
                <LaptopIcon className="size-4 text-muted-foreground" />
                {device.name}
              </span>
            }
            description={
              device.current ? "This Mac" : `Last active ${timeAgo(device.lastActiveAt)}`
            }
            control={
              device.current ? null : (
                <Btn
                  size="sm"
                  disabled={signOutDevice.isPending}
                  onClick={() => signOutDevice.mutate(device)}
                >
                  Sign out
                </Btn>
              )
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

function SignedInPane({ state }: { state: OtterAccountState }) {
  const user = state.user!;
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = REALTIME_STATUS[state.realtime];

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .catch((err: unknown) => toast.error(failure, { description: errorText(err) }))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          title={
            <span className="flex items-center gap-2.5">
              <OtterAvatar user={user} />
              {user.name ?? user.email}
            </span>
          }
          description={user.email}
          status={
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-1.5 rounded-full", status.dot)} />
              {status.text}
            </span>
          }
          control={
            <Btn
              size="sm"
              disabled={busy}
              onClick={() => run(otterApi.signOut, "Couldn't sign out")}
            >
              Sign out
            </Btn>
          }
        />
      </SettingsGroup>

      <DevicesSection />

      <SettingsSection title="Delete account">
        <SettingsRow
          title="Delete Otter account"
          description="Removes your account and its list of linked accounts from Otter Mail's servers, and signs out every Mac. Your mail and the accounts on each Mac stay."
          control={
            <Btn size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Btn>
          }
        />
      </SettingsSection>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your Otter account?"
        confirmLabel={busy ? "Deleting…" : "Delete account"}
        confirmVariant="destructive"
        onConfirm={() =>
          run(
            () => otterApi.deleteAccount().then(() => setConfirmDelete(false)),
            "Couldn't delete the account",
          )
        }
      >
        <Text variant="small">
          Otter Mail's servers forget {user.email} and the accounts linked to it, and every Mac
          signs out. Nothing is deleted from Gmail, and this Mac keeps its accounts and mail.
        </Text>
      </Dialog>
    </>
  );
}

export function OtterAccountPane() {
  const state = useOtterAccount();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-16 pt-4 sm:px-6">
        {!state ? null : state.user ? (
          <SignedInPane state={state} />
        ) : (
          <SettingsGroup>
            <SettingsRow
              title="Sign in to Otter Mail"
              description="Your linked accounts on every Mac you use, and new mail the moment it arrives. Otter Mail's servers only learn your addresses, never your mail."
              control={<SignInControl />}
            />
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}

/** First-run alternative to adding a Gmail account: bring the accounts from another Mac. */
export function OtterSignInOnboardingButton() {
  const [pending, setPending] = useState(false);
  if (pending) {
    return (
      <Button variant="outline" onClick={() => void otterApi.cancelSignIn()}>
        Cancel sign-in
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={() => {
        setPending(true);
        otterApi
          .signIn()
          .catch((err: unknown) => {
            toast.error("Couldn't sign in to Otter Mail", { description: errorText(err) });
          })
          .finally(() => setPending(false));
      }}
    >
      Sign in to Otter Mail
    </Button>
  );
}
