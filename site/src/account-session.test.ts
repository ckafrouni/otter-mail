import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vite-plus/test";

const script = readFileSync(new URL("../public/account-session.js", import.meta.url), "utf8");

it.each([true, false])(
  "only opens Mail automatically when Accounts is signed in: %s",
  async (signedIn) => {
    const replace = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ signedIn }) });
    runInNewContext(script, {
      URL,
      fetch,
      location: { hostname: "mail.otterware.app", href: "https://mail.otterware.app/", replace },
    });
    await new Promise(setImmediate);
    expect(fetch).toHaveBeenCalledWith("https://accounts.otterware.app/otter/session", {
      credentials: "include",
    });
    expect(replace.mock.calls).toEqual(signedIn ? [["/app"]] : []);
  },
);

it.each(["https://mail.otterware.app/?signed_out=1", "http://localhost:4321/"])(
  "keeps sign-out and local development on the landing page: %s",
  (href) => {
    const fetch = vi.fn();
    runInNewContext(script, { URL, fetch, location: { hostname: new URL(href).hostname, href } });
    expect(fetch).not.toHaveBeenCalled();
  },
);
