import { Button } from "~/components/ui/button";
import { gmailApi } from "./api";
import { useAddAccount } from "./hooks";
import { toast } from "./toast";
import type { GmailAccount } from "./types";

/**
 * A mailbox with nothing to show because this Mac isn't signed in to the
 * account: typically one that came from another Mac through the Otter
 * account. One click signs in, with the address prefilled.
 */
export function SignedOutMailbox({ account }: { account: GmailAccount }) {
  const signIn = useAddAccount();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
      <span className="text-sm font-medium text-foreground">Not signed in on this Mac</span>
      <span className="text-sm text-muted-foreground">
        Sign in to {account.email} with Google to see its mail here.
      </span>
      <div className="pt-3">
        {signIn.isPending ? (
          <Button size="small" onClick={() => void gmailApi.cancelAddAccount()}>
            Cancel sign-in
          </Button>
        ) : (
          <Button
            size="small"
            variant="accent"
            onClick={() =>
              void signIn.mutateAsync(account.email).catch((err: unknown) => {
                toast.error(`Couldn't sign in to ${account.email}`, {
                  description: err instanceof Error ? err.message : String(err),
                });
              })
            }
          >
            Sign in with Google
          </Button>
        )}
      </div>
    </div>
  );
}
