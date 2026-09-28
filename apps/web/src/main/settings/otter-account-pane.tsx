import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OtterAccountState, OtterDevice } from "@otter-mail/contracts";
import { LaptopIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import { useAccounts } from "../gmail/hooks";
import { toast } from "../gmail/toast";
import { Btn, cn } from "../gmail/ui";
import { otterApi, useOtterAccount } from "../otter-account";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-ui";

/**
 * Settings › Otter account, opened from the user button at the bottom of the
 * settings sidebar (as in Otter Code): who is signed in, whether mail arrives
 * by push, the devices signed in, sign-out and deletion. Signed out, it explains
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

/**
 * "Sign in with Google" for the Otter account (never a mailbox): Google in the
 * browser on the desktop, a redirect on the web. Cancellable while it waits.
 */
function useOtterSignIn() {
  const [pending, setPending] = useState(false);
  const signIn = () => {
    setPending(true);
    otterApi
      .signIn()
      .catch((err: unknown) => {
        toast.error("Couldn't sign in to Otter Mail", { description: errorText(err) });
      })
      .finally(() => setPending(false));
  };
  return { pending, signIn, cancel: () => void otterApi.cancelSignIn() };
}

function SignInControl() {
  const { pending, signIn, cancel } = useOtterSignIn();
  return pending ? (
    <Btn size="sm" onClick={cancel}>
      Cancel sign-in
    </Btn>
  ) : (
    <Btn size="sm" variant="primary" onClick={signIn}>
      Sign in with Google
    </Btn>
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
    onError: (err) => toast.error("Couldn't sign that device out", { description: errorText(err) }),
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
              device.current ? "This device" : `Last active ${timeAgo(device.lastActiveAt)}`
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
  const mailboxes = useAccounts().data?.length ?? 0;
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
          description={`${user.email} · ${
            mailboxes === 1 ? "Your mailbox follows" : `Your ${mailboxes} mailboxes follow`
          } you to every device`}
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
          description="Removes your account and its list of mailboxes from Otter Mail's servers, and signs out every device. Your mail and the mailboxes on each device stay."
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
          Otter Mail's servers forget {user.email} and its list of mailboxes, and every device signs
          out. Nothing is deleted from Gmail, and this device keeps its mailboxes and mail.
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
              description="Your mailboxes on every device you use, and new mail the moment it arrives. Otter Mail's servers only learn your addresses, never your mail."
              control={<SignInControl />}
            />
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}

/** First run (on the desktop, signed out): for someone who already has an Otter account. */
export function OtterSignInOnboardingLink() {
  const state = useOtterAccount();
  const { pending, signIn, cancel } = useOtterSignIn();
  if (!state || state.user) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {pending ? (
        <button type="button" className="cursor-pointer underline" onClick={cancel}>
          Cancel sign-in
        </button>
      ) : (
        <>
          Already use Otter Mail?{" "}
          <button
            type="button"
            className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
            onClick={signIn}
          >
            Sign in
          </button>
        </>
      )}
    </p>
  );
}
