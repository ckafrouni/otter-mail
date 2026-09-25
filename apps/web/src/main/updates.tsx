import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "@otter-mail/contracts";

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
 * App-wide update prompts (mounted once in the main window): a toast when a
 * new version is available and again once it is ready to install. The app
 * menu's "Check for Updates…" lands here too.
 */
export function UpdateNotifier() {
  const state = useUpdateState();
  const announced = useRef<string | null>(null);
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
    if (!state) return;
    if (manualCheck.current) {
      if (state.status === "up-to-date") {
        manualCheck.current = false;
        toast.success("Otter Mail is up to date", {
          description: `Version ${state.currentVersion}`,
        });
      } else if (state.status === "disabled" || state.status === "error") {
        manualCheck.current = false;
        toast.error("Couldn't check for updates", { description: state.message ?? undefined });
      } else if (state.status === "available") {
        manualCheck.current = false;
      }
    }
    const key = `${state.status}:${state.availableVersion}`;
    if (announced.current === key) return;
    if (state.status === "available") {
      announced.current = key;
      toast.info(`Otter Mail ${state.availableVersion} is available`, {
        timeout: 0,
        action: { label: "Download", onClick: () => void window.desktopBridge.updates.download() },
      });
    } else if (state.status === "downloaded") {
      announced.current = key;
      toast.success(`Otter Mail ${state.availableVersion} is ready`, {
        description: "Restart to finish updating.",
        timeout: 0,
        action: { label: "Restart", onClick: () => void window.desktopBridge.updates.install() },
      });
    }
  }, [state]);

  return null;
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
      return state.channel === "nightly"
        ? "Following nightly builds."
        : "Following stable releases.";
  }
}

/** Settings → General: version, channel, and the check/download/restart button. */
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
        title={`Otter Mail ${state.currentVersion}${state.channel === "nightly" ? " (nightly)" : ""}`}
        description={statusLine(state)}
        control={control}
      />
    </SettingsSection>
  );
}
