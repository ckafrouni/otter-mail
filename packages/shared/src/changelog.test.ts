import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { changelogImageName, parseChangelogEntry } from "./changelog.ts";

const notes = NodePath.resolve(import.meta.dirname, "../../../changelog");

describe("changelog", () => {
  const entries = NodeFS.readdirSync(notes)
    .filter((name) => /^\d+\.\d+\.\d+\.md$/.test(name))
    .map((name) =>
      parseChangelogEntry(
        name.slice(0, -3),
        NodeFS.readFileSync(NodePath.join(notes, name), "utf8"),
      ),
    );

  it("parses every note", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.title.length, e.version).toBeGreaterThan(0);
      expect(e.body.length, e.version).toBeGreaterThan(0);
    }
  });

  it("finds every image a note shows", () => {
    for (const e of entries) {
      for (const [, src] of e.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const name = changelogImageName(src!);
        expect(name, `${e.version}: ${src} should be images/<file>`).not.toBeNull();
        expect(
          NodeFS.existsSync(NodePath.join(notes, "images", name!)),
          `${e.version}: ${src}`,
        ).toBe(true);
      }
    }
  });
});
