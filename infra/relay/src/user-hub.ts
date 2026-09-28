/**
 * One Durable Object per Otter account: holds the WebSocket of every device
 * signed in to it and fans relay events out to them. Uses hibernation, so
 * idle connections cost nothing, and answers `ping` with `pong` without
 * waking up.
 */

import { DurableObject } from "cloudflare:workers";
import type { RelayEvent } from "@otter-mail/contracts/relay";

/** Set by the Worker on the upgrade request it forwards: the socket's session. */
export const SESSION_HEADER = "x-otter-session";

export class UserHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Accepts a device's WebSocket (the Worker already authenticated it). */
  override async fetch(request: Request): Promise<Response> {
    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) return new Response("Missing session", { status: 400 });
    const { 0: client, 1: server } = new WebSocketPair();
    // Tagged with the session, so signing out closes exactly that device's sockets.
    this.ctx.acceptWebSocket(server, [sessionId]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends the event to every connected device; returns how many got it. */
  publish(event: RelayEvent): number {
    const message = JSON.stringify(event);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // Already closing; its device reconnects and catches up.
      }
    }
    return delivered;
  }

  /** Closes a signed-out session's sockets, or every socket when the account is deleted. */
  disconnect(sessionId?: string): void {
    for (const socket of this.ctx.getWebSockets(sessionId)) {
      socket.close(4001, "Signed out");
    }
  }

  override webSocketMessage(): void {
    // Clients only send `ping`, which the auto-response answers.
  }

  override webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Codes like 1006 can't be echoed; the socket is gone either way.
    }
  }
}
