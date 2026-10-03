// Extends the existing brand icon system with the built-in palettes.
// macOS only (Swift / ImageIO). Run with `pnpm icons:themes`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP_THEMES, getThemeColorsForAppearance } from "../packages/shared/src/theme-palettes.ts";

const root = resolve(import.meta.dirname, "..");
const catalog = join(root, "apps/ios/OtterMail/Assets.xcassets");
const desktop = join(root, "apps/desktop/resources/app-icons");
const web = join(root, "apps/web/src/main/assets/app-icons");
const scratch = mkdtempSync(join(tmpdir(), "otter-theme-icons-"));
const jobs: {
  source: string;
  output: string;
  background: string;
  accent: string;
  opaque: boolean;
}[] = [];
const json = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const info = { author: "xcode", version: 1 };
const resize = (source: string, output: string, size: number) =>
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", output], {
    stdio: "ignore",
  });

try {
  mkdirSync(desktop, { recursive: true });
  mkdirSync(web, { recursive: true });
  for (const theme of APP_THEMES) {
    const colors = getThemeColorsForAppearance(theme, "dark")!;
    for (const platform of ["ios", "macos"]) {
      const source = join(root, `assets/prod/otter-mail-${platform}-1024.png`);
      const output = join(scratch, `${theme.id}-${platform}.png`);
      if (theme.id === "codex") copyFileSync(source, output);
      else
        jobs.push({
          source,
          output,
          background: colors.sidebar,
          accent: colors.accent,
          opaque: platform === "ios",
        });
    }
  }
  const jobFile = join(scratch, "jobs.json");
  json(jobFile, jobs);
  execFileSync("swift", [join(root, "scripts/lib/theme-icons.swift"), jobFile], {
    stdio: "inherit",
  });

  for (const { id } of APP_THEMES) {
    const ios = join(scratch, `${id}-ios.png`);
    // Codex uses the existing primary AppIcon, restored with setAlternateIconName(nil).
    if (id !== "codex") {
      const dir = join(catalog, `AppIcon-${id}.appiconset`);
      mkdirSync(dir, { recursive: true });
      copyFileSync(ios, join(dir, "icon-1024.png"));
      json(join(dir, "Contents.json"), {
        images: [
          { filename: "icon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        ],
        info,
      });
    }
    const preview = join(catalog, `AppIconPreview-${id}.imageset`);
    mkdirSync(preview, { recursive: true });
    resize(ios, join(preview, "icon.png"), 192);
    json(join(preview, "Contents.json"), {
      images: [{ filename: "icon.png", idiom: "universal" }],
      info,
    });
    resize(ios, join(web, `${id}.png`), 192);
    resize(join(scratch, `${id}-macos.png`), join(desktop, `${id}.png`), 512);
  }
  console.log(`Exported ${APP_THEMES.length} app icons for iOS, macOS and web.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
