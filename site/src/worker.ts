/**
 * mail.otterware.app: the web app, for every page that isn't one of its files
 * (/you@gmail.com/INBOX/…, /settings/…); it signs in first if need be. Otter
 * Mail's page, changelog, privacy policy and terms are on otterware.app: their
 * old addresses here (in Google's consent screen, past releases' notes, links
 * out there) go to them.
 */

interface Env {
  ASSETS: Fetcher;
}

const SITE = "https://otterware.app/mail";

/** A release's old page, now its note on the one changelog page. */
const CHANGELOG_VERSION = /^\/changelog\/(\d+\.\d+\.\d+)\/?$/;

/** Pages that moved to otterware.app/mail/, and what is under them. */
const MOVED = /^\/(?:changelog|privacy|terms)(?:\/|$)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "mail.otterware.dev") {
      // Google's consent screen still links Otter Mail's home page here: the
      // product page, not the app (which only asks a visitor to sign in).
      if (url.pathname === "/") return Response.redirect(`${SITE}/`, 301);
      url.protocol = "https:";
      url.hostname = "mail.otterware.app";
      url.port = "";
      return Response.redirect(url.toString(), 308);
    }
    const version = CHANGELOG_VERSION.exec(url.pathname)?.[1];
    if (version) return Response.redirect(`${SITE}/changelog/#${version}`, 301);
    if (MOVED.test(url.pathname)) {
      const path =
        url.pathname.endsWith("/") || url.pathname.includes(".")
          ? url.pathname
          : `${url.pathname}/`;
      return Response.redirect(`${SITE}${path}`, 301);
    }
    const response = await env.ASSETS.fetch(request);
    // A browser opening one of the app's pages (it routes them itself). Missing
    // files stay missing.
    if (response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
