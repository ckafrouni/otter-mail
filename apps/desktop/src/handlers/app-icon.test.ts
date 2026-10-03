import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  directory: "",
  missingImage: false,
  handlers: new Map<string, (_event?: unknown, params?: unknown) => unknown>(),
  setIcon: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => fixture.directory,
    getAppPath: () => "/app",
    dock: { setIcon: fixture.setIcon },
  },
  nativeImage: {
    createFromPath: (path: string) => ({ path, isEmpty: () => fixture.missingImage }),
  },
  ipcMain: {
    handle: (channel: string, handler: (_event?: unknown, params?: unknown) => unknown) =>
      fixture.handlers.set(channel, handler),
  },
}));
vi.mock("../ipc.js", () => ({ broadcast: fixture.broadcast }));
vi.mock("../logger.js", () => ({ logger: { warn: vi.fn() } }));

const { registerAppIconHandlers } = await import("./app-icon.js");
const get = () => fixture.handlers.get("appIcon:get")!();
const pick = (id: unknown) => fixture.handlers.get("appIcon:set")!(null, id);

beforeEach(() => {
  fixture.directory = mkdtempSync(join(tmpdir(), "otter-app-icon-"));
  fixture.missingImage = false;
  fixture.handlers.clear();
  vi.clearAllMocks();
  registerAppIconHandlers();
});
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));

describe("app icon", () => {
  it("changes the Dock, notifies other windows and restores the choice on relaunch", () => {
    expect(get()).toBe("codex");
    expect(pick("grove")).toBe("grove");
    expect(fixture.setIcon).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/app/resources/app-icons/grove.png" }),
    );
    expect(fixture.broadcast).toHaveBeenLastCalledWith("appIcon:changed", "grove");
    registerAppIconHandlers();
    expect(get()).toBe("grove");
    expect(pick("codex")).toBe("codex");
    registerAppIconHandlers();
    expect(get()).toBe("codex");
  });

  it("keeps the previous choice when a request or its image is invalid", () => {
    pick("iris");
    for (const id of ["../../icon", "custom-theme", {}, null]) {
      expect(() => pick(id)).toThrow("Unknown app icon");
    }
    fixture.missingImage = true;
    expect(() => pick("ocean")).toThrow("Couldn't load");
    expect(get()).toBe("iris");
    expect(JSON.parse(readFileSync(join(fixture.directory, "app-icon.json"), "utf8"))).toBe("iris");
    expect(fixture.setIcon).toHaveBeenCalledTimes(1);
  });

  it("recovers from an invalid saved choice without changing the Dock", () => {
    writeFileSync(join(fixture.directory, "app-icon.json"), "not json");
    registerAppIconHandlers();
    expect(get()).toBe("codex");
    expect(fixture.setIcon).not.toHaveBeenCalled();
  });
});
