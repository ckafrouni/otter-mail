import { useSyncExternalStore } from "react";
import { Uniwind } from "uniwind";

import { getSetting, setSetting } from "./db";

export type Appearance = "system" | "light" | "dark";

const listeners = new Set<() => void>();
let appearance = (getSetting("appearance") as Appearance | null) ?? "system";
Uniwind.setTheme(appearance);

export function setAppearance(next: Appearance): void {
  appearance = next;
  setSetting("appearance", next);
  Uniwind.setTheme(next);
  for (const listener of listeners) listener();
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => appearance,
  );
}
