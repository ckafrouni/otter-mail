/**
 * mail.otterware.app: the landing page for visitors, the web app for anyone
 * signed in to Otter Mail (the relay's session cookie is shared with this
 * domain). Everything else is static: /app (the app itself), /privacy,
 * /terms, and the app's assets.
 */

interface Env {
  ASSETS: Fetcher;
}

/** better-auth's session cookie (the __Secure- prefix over https). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "mail.otterware.dev") {
      url.protocol = "https:";
      url.hostname = "mail.otterware.app";
      url.port = "";
      return Response.redirect(url.toString(), 308);
    }
    const signedIn = SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
    // "/app" serves app.html (with the app's relative asset paths still resolving from /).
    const page = url.pathname === "/" && signedIn ? new URL("/app", url) : url;
    return env.ASSETS.fetch(new Request(page, request));
  },
} satisfies ExportedHandler<Env>;
