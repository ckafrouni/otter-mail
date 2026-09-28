/// <reference lib="webworker" />
/**
 * The web app's backend: @otter-mail/core in a Web Worker, as the desktop app
 * runs it in Electron's main process. The page (bridge.ts) invokes its
 * handlers and receives its pushes; see protocol.ts.
 */

import { registeredHandlers, startCore } from "@otter-mail/core";

import { webPlatform, type Page } from "./platform";
import type { FromWorker, PageRequests, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const post = (message: FromWorker) => self.postMessage(message, []);

let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const resumeListeners = new Set<() => void>();

const page: Page = {
  request<K extends keyof PageRequests>(kind: K, params: PageRequests[K]["params"]) {
    const id = nextRequestId++;
    post({ type: "request", id, kind, params });
    return new Promise<PageRequests[K]["result"]>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
  },
  effect: (effect) => post({ type: "effect", ...effect }),
  broadcast: (channel, params) => post({ type: "event", channel, params }),
  onResume(listener) {
    resumeListeners.add(listener);
    return () => resumeListeners.delete(listener);
  },
};

async function invoke(id: number, channel: string, params: unknown): Promise<void> {
  const handler = registeredHandlers().get(channel);
  try {
    if (!handler) throw new Error(`No handler for ${channel}.`);
    post({ type: "result", id, result: await handler(params) });
  } catch (err) {
    post({ type: "result", id, error: err instanceof Error ? err.message : String(err) });
  }
}

const ready = webPlatform(page).then(startCore);

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "invoke") {
    void ready.then(() => invoke(message.id, message.channel, message.params));
  } else if (message.type === "reply") {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error !== undefined) request?.reject(new Error(message.error));
    else request?.resolve(message.result);
  } else if (message.type === "resume") {
    for (const listener of resumeListeners) listener();
  }
});

self.addEventListener("online", () => {
  for (const listener of resumeListeners) listener();
});

ready.then(
  () => post({ type: "ready" }),
  (err: unknown) =>
    post({ type: "failed", error: err instanceof Error ? err.message : String(err) }),
);
