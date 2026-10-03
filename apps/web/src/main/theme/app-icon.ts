import { useSyncExternalStore } from "react";
import { DEFAULT_APP_ICON, isAppIcon } from "@otter-mail/shared/app-icons";

const images = import.meta.glob<string>("../assets/app-icons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export function appIconUrl(id: string): string {
  return images[`../assets/app-icons/${isAppIcon(id) ? id : DEFAULT_APP_ICON}.png`]!;
}

let chosen = DEFAULT_APP_ICON;
let revision = 0;
const listeners = new Set<() => void>();

function applyIcon(value: unknown): void {
  if (!isAppIcon(value)) return;
  revision++;
  chosen = value;
  for (const rel of ["icon", "apple-touch-icon"]) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = appIconUrl(value);
  }
  for (const listener of listeners) listener();
}

export async function setAppIcon(id: string): Promise<void> {
  applyIcon(await window.desktopBridge.invoke("appIcon:set", id));
}

/** The shell owns persistence and changes from other windows. */
export function startAppIcon(): () => void {
  let active = true;
  const initialRevision = revision;
  const unsubscribe = window.desktopBridge.on("appIcon:changed", applyIcon);
  void window.desktopBridge
    .invoke("appIcon:get")
    .then((id) => {
      if (active && revision === initialRevision) applyIcon(id);
    })
    .catch((error: unknown) => console.error("Couldn't restore the app icon:", error));
  return () => {
    active = false;
    unsubscribe();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppIcon(): string {
  return useSyncExternalStore(subscribe, () => chosen);
}
