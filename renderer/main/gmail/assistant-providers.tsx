/**
 * Renderer side of the assistant providers: the live provider state, icons,
 * and the status wording shared by Settings and the chat composer (ported
 * from T3 Code's providerStatus / providerDriverMeta).
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gmailApi, type ProviderKind, type ProviderSnapshot, type ProvidersState } from "./api";
import { cn } from "./ui";
import hermesIconUrl from "../assets/hermes-agent-icon.png";

const PROVIDERS_KEY = ["assistant-providers"] as const;

/** Provider snapshots + settings, kept live by `assistant:providersChanged`. */
export function useAssistantProviders() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.glazeAPI.glaze.ipc.onNotification("assistant:providersChanged", (state: unknown) =>
        qc.setQueryData(PROVIDERS_KEY, state as ProvidersState),
      ),
    [qc],
  );
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => gmailApi.assistantProviders(),
    staleTime: 30_000,
  });
}

/** Writes the state an update call returns, so the UI doesn't wait for the broadcast. */
export function useSetProvidersState() {
  const qc = useQueryClient();
  return (state: ProvidersState) => qc.setQueryData(PROVIDERS_KEY, state);
}

/** OpenAI mark, as T3 Code draws Codex. */
function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg
      preserveAspectRatio="xMidYMid"
      viewBox="0 0 256 260"
      className={cn("fill-black dark:fill-white", className)}
      aria-hidden
    >
      <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
    </svg>
  );
}

/**
 * The Hermes Agent mark (the Nous mascot), as T3 Code's HermesIcon draws it.
 * Black-on-white art in a rounded tile, so it doesn't follow currentColor.
 */
function HermesIcon({ className }: { className?: string }) {
  return <img src={hermesIconUrl} alt="" aria-hidden draggable={false} className={className} />;
}

export function ProviderIcon({ kind, className }: { kind: ProviderKind; className?: string }) {
  return kind === "codex" ? (
    <OpenAIIcon className={cn("size-4", className)} />
  ) : (
    <HermesIcon className={cn("size-4", className)} />
  );
}

export const PROVIDER_STATUS_DOT: Record<ProviderSnapshot["status"], string> = {
  disabled: "bg-muted-foreground/50",
  error: "bg-destructive",
  ready: "bg-success",
  warning: "bg-warning",
};

/** `1.2.3` → `v1.2.3`. */
export function providerVersionLabel(version: string | null): string | null {
  if (!version) return null;
  return /^\d+\.\d+/.test(version) ? `v${version}` : version;
}

/** Headline + detail for a provider, in T3 Code's precedence order. */
export function providerSummary(p: ProviderSnapshot | undefined): { headline: string; detail?: string } {
  if (!p || (p.checkedAt === null && p.enabled))
    return { headline: "Checking provider status", detail: "Waiting for installation and authentication details." };
  if (!p.enabled || p.status === "disabled")
    return { headline: "Disabled", detail: `${p.displayName} is turned off for new chats.` };
  if (!p.installed)
    return {
      headline: p.kind === "hermes" ? "Not connected" : "Not found",
      detail: p.message ?? (p.kind === "codex" ? "CLI not detected on PATH." : undefined),
    };
  if (p.auth.status === "unauthenticated") return { headline: "Not authenticated", detail: p.message };
  if (p.status === "warning")
    return { headline: "Needs attention", detail: p.message ?? "The provider could not be fully verified." };
  if (p.status === "error")
    return { headline: "Unavailable", detail: p.message ?? "The provider failed its startup checks." };
  if (p.auth.status === "authenticated")
    return { headline: p.auth.label ? `Authenticated · ${p.auth.label}` : "Authenticated", detail: p.message };
  return { headline: "Available", detail: p.message };
}

/** A provider that can take a turn right now. */
export function isProviderUsable(p: ProviderSnapshot | undefined): boolean {
  return Boolean(p && p.enabled && p.status !== "error" && (p.installed || p.checkedAt === null));
}
