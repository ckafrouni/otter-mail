import { describe, expect, it, vi } from "vite-plus/test";
import type { RelayAccount } from "@otter-mail/contracts/relay";

vi.mock("electron", () => ({ app: {}, safeStorage: {}, shell: {}, BrowserWindow: {} }));

const { planReconcile } = await import("./linked-accounts.ts");

const local = (
  email: string,
  extra: { signedIn?: boolean; displayName?: string; color?: string } = {},
) => ({
  email,
  signedIn: extra.signedIn ?? true,
  displayName: extra.displayName,
  color: extra.color,
});

const remote = (email: string, extra: Partial<RelayAccount> = {}): RelayAccount => ({
  email,
  name: null,
  picture: null,
  displayName: null,
  color: null,
  ...extra,
});

const none = { link: [], unlink: [], add: [], remove: [], update: [] };

describe("planReconcile", () => {
  it("does nothing when both sides agree", () => {
    const plan = planReconcile([local("a@x.com")], [remote("a@x.com")], new Set(["a@x.com"]));
    expect(plan).toEqual(none);
  });

  it("first sign-in merges: links what's here, adds what's there", () => {
    const plan = planReconcile(
      [local("here@x.com"), local("both@x.com")],
      [remote("there@x.com"), remote("both@x.com")],
      new Set(),
    );
    expect(plan).toEqual({ ...none, link: ["here@x.com"], add: [remote("there@x.com")] });
  });

  it("can't link a signed-out account (no proof); leaves it alone", () => {
    const plan = planReconcile([local("out@x.com", { signedIn: false })], [], new Set());
    expect(plan).toEqual(none);
  });

  it("an account linked last time and now gone from the relay was removed elsewhere", () => {
    const plan = planReconcile(
      [local("a@x.com"), local("b@x.com")],
      [remote("a@x.com")],
      new Set(["a@x.com", "b@x.com"]),
    );
    expect(plan).toEqual({ ...none, remove: ["b@x.com"] });
  });

  it("an account linked last time and now gone from here was removed here", () => {
    const plan = planReconcile(
      [local("a@x.com")],
      [remote("a@x.com"), remote("b@x.com")],
      new Set(["a@x.com", "b@x.com"]),
    );
    expect(plan).toEqual({ ...none, unlink: ["b@x.com"] });
  });

  it("takes profile edits made elsewhere", () => {
    const edited = remote("a@x.com", { displayName: "Work", color: "#f00" });
    const plan = planReconcile([local("a@x.com")], [edited], new Set(["a@x.com"]));
    expect(plan).toEqual({ ...none, update: [edited] });

    const same = planReconcile(
      [local("a@x.com", { displayName: "Work", color: "#f00" })],
      [edited],
      new Set(["a@x.com"]),
    );
    expect(same).toEqual(none);
  });

  it("compares addresses without case", () => {
    const plan = planReconcile([local("Me@X.com")], [remote("me@x.com")], new Set());
    expect(plan).toEqual(none);
  });
});
