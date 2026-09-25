import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "@otter-mail/contracts";

import { ArrowDownCircleIcon, SparklesIcon, XIcon } from "lucide-react";

import { Btn } from "./gmail/ui";
import { toast } from "./gmail/toast";
import { SettingsRow, SettingsSection } from "./settings/settings-ui";

/** Live auto-update state from the main process. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    void window.desktopBridge.updates.getState().then((next) => {
      if (alive) setState(next);
    });
    const off = window.desktopBridge.updates.onState(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/**
 * Feedback for the app menu's "Check for Updates…" (mounted once in the main
 * window). Updates themselves download on their own and surface in the
 * sidebar's UpdateCard.
 */
export function UpdateNotifier() {
  const state = useUpdateState();
  const manualCheck = useRef(false);

  useEffect(
    () =>
      window.desktopBridge.on("updates:checkRequested", () => {
        manualCheck.current = true;
        void window.desktopBridge.updates.check();
      }),
    [],
  );

  useEffect(() => {
    if (!state || !manualCheck.current) return;
    if (state.status === "up-to-date") {
      manualCheck.current = false;
      toast.success("Otter Mail is up to date", { description: `Version ${state.currentVersion}` });
    } else if (state.status === "disabled" || state.status === "error") {
      manualCheck.current = false;
      toast.error("Couldn't check for updates", { description: state.message ?? undefined });
    } else if (state.status === "downloading" || state.status === "downloaded") {
      manualCheck.current = false;
      toast.info(`Otter Mail ${state.availableVersion} is on its way`, {
        description: "It's downloading; the sidebar offers a restart when it's ready.",
      });
    }
  }, [state]);

  return null;
}

/**
 * A small card at the bottom of the sidebar while an update downloads and once
 * it's ready: "Restart to update" (it also installs on the next real quit).
 */
export function UpdateCard() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!state?.availableVersion || dismissed === state.availableVersion) return null;
  const failed = state.status === "error";
  if (state.status !== "downloading" && state.status !== "downloaded" && !failed) return null;

  const version = state.availableVersion;
  const percent = Math.min(100, Math.max(0, state.downloadPercent ?? 0));
  return (
    <div className="mx-(--sidebar-content-inset) mb-1 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 shadow-xs/5">
      <div className="flex items-start gap-2">
        {state.status === "downloaded" ? (
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <ArrowDownCircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {state.status === "downloaded"
              ? `Otter Mail ${version} is ready`
              : failed
                ? `Couldn't update to ${version}`
                : `Downloading Otter Mail ${version}`}
          </p>
          <p className="text-2xs text-muted-foreground">
            {state.status === "downloaded"
              ? "Restart to finish updating."
              : failed
                ? "It will try again later."
                : `${percent}%`}
          </p>
        </div>
        {state.status === "downloaded" ? (
          <button
            type="button"
            aria-label="Hide until next launch"
            onClick={() => setDismissed(version)}
            className="-mr-1 -mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <XIcon className="size-3" />
          </button>
        ) : null}
      </div>
      {state.status === "downloading" ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      {state.status === "downloaded" ? (
        <Btn
          size="xs"
          variant="primary"
          className="mt-2 w-full"
          onClick={() => void window.desktopBridge.updates.install()}
        >
          Restart to update
        </Btn>
      ) : null}
      {failed ? (
        <Btn
          size="xs"
          className="mt-2 w-full"
          onClick={() => void window.desktopBridge.updates.download()}
        >
          Retry
        </Btn>
      ) : null}
    </div>
  );
}

function statusLine(state: UpdateState): string {
  switch (state.status) {
    case "disabled":
      return state.message ?? "Updates are unavailable in this build.";
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Version ${state.availableVersion} is available.`;
    case "downloading":
      return `Downloading version ${state.availableVersion}… ${state.downloadPercent ?? 0}%`;
    case "downloaded":
      return `Version ${state.availableVersion} is ready. Restart to install it.`;
    case "up-to-date":
      return "You're on the latest version.";
    case "error":
      return state.message ?? "The last update check failed.";
    default:
      return "Updates download on their own.";
  }
}

/** Settings → General: version, status, and the check / restart button. */
export function UpdatesSection() {
  const state = useUpdateState();
  if (!state) return null;

  const updates = window.desktopBridge.updates;
  const control =
    state.status === "available" ? (
      <Btn variant="primary" size="sm" onClick={() => void updates.download()}>
        Download
      </Btn>
    ) : state.status === "downloaded" ? (
      <Btn variant="primary" size="sm" onClick={() => void updates.install()}>
        Restart to Update
      </Btn>
    ) : (
      <Btn
        size="sm"
        disabled={
          state.status === "disabled" ||
          state.status === "checking" ||
          state.status === "downloading"
        }
        onClick={() => void updates.check()}
      >
        Check for Updates
      </Btn>
    );

  return (
    <SettingsSection title="Updates">
      <SettingsRow
        title={`Otter Mail ${state.currentVersion}`}
        description={statusLine(state)}
        control={control}
      />
    </SettingsSection>
  );
}
