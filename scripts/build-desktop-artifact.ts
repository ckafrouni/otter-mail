#!/usr/bin/env node
// Builds the distributable Otter Mail app (DMG + ZIP for macOS) with
// electron-builder.
//
//   node scripts/build-desktop-artifact.ts --platform mac --arch arm64
//   node scripts/build-desktop-artifact.ts --platform mac --arch both --build-version 0.2.0 --signed
//
// Steps: build web + desktop bundles and the universal translator, stage a
// self-contained app directory (package.json, dist-electron/, renderer/, the
// translator), run electron-builder on it, and copy the artifacts and update
// manifests into --output-dir. The main process and preload are fully
// bundled, so the stage has no node_modules.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

import { buildTranslator, findTranslatorBinary, repoRoot } from "./build-translator.ts";

const APP_ID = "dev.otterware.mail";
const PRODUCT_NAME = "Otter Mail";
const DEFAULT_UPDATE_REPOSITORY = "ckafrouni/otter-mail";
const ARCHES = ["arm64", "x64", "universal", "both"] as const;
type Arch = (typeof ARCHES)[number];

const desktopDir = NodePath.join(repoRoot, "apps", "desktop");
const webDir = NodePath.join(repoRoot, "apps", "web");
const vpBin = NodePath.join(repoRoot, "node_modules", ".bin", "vp");
const electronBuilderBin = NodePath.join(desktopDir, "node_modules", ".bin", "electron-builder");

const HELP = `Usage: node scripts/build-desktop-artifact.ts [options]

Options:
  --platform mac            Target platform (only mac is supported). Default: mac.
  --target dmg              Installer target; a zip is always built too (auto-update
                            needs it). Default: dmg.
  --arch <arch>             arm64 | x64 | universal | both. \`both\` builds arm64 and
                            x64 in one run so latest-mac.yml lists both.
                            Default: host architecture.
  --build-version <v>       App version. Default: apps/desktop/package.json version.
  --output-dir <dir>        Where artifacts are copied. Default: release/.
  --skip-build              Reuse existing apps/web/dist, apps/desktop/dist-electron
                            and translator builds.
  --keep-stage              Keep the temporary staging directory.
  --signed                  Sign with Developer ID (CSC_LINK, CSC_KEY_PASSWORD) and
                            notarize (APPLE_API_KEY, APPLE_API_KEY_ID,
                            APPLE_API_ISSUER). Unsigned builds are ad hoc.
  --verbose                 Print electron-builder debug output.
  -h, --help                Show this help.

Environment:
  OTTER_MAIL_UPDATE_REPOSITORY  owner/repo for the GitHub update feed
                                (falls back to GITHUB_REPOSITORY, then
                                ${DEFAULT_UPDATE_REPOSITORY}).
`;

interface Options {
  readonly platform: "mac";
  readonly target: string;
  readonly arch: Arch;
  readonly version: string;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
}

function readJson<T>(path: string): T {
  return JSON.parse(NodeFS.readFileSync(path, "utf8")) as T;
}

function log(message: string): void {
  console.log(`[desktop-artifact] ${message}`);
}

function fail(message: string): never {
  console.error(`[desktop-artifact] ${message}`);
  process.exit(1);
}

function hostArch(): Arch {
  return process.arch === "arm64" ? "arm64" : "x64";
}

export function parseOptions(argv: readonly string[]): Options | null {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      platform: { type: "string", default: "mac" },
      target: { type: "string", default: "dmg" },
      arch: { type: "string" },
      "build-version": { type: "string" },
      "output-dir": { type: "string", default: "release" },
      "skip-build": { type: "boolean", default: false },
      "keep-stage": { type: "boolean", default: false },
      signed: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return null;

  if (values.platform !== "mac") {
    throw new Error(`Unsupported --platform "${values.platform}". Only "mac" is supported.`);
  }
  if (values.target !== "dmg" && values.target !== "zip") {
    throw new Error(`Unsupported --target "${values.target}". Use "dmg" (or "zip").`);
  }
  const arch = (values.arch ?? hostArch()) as Arch;
  if (!ARCHES.includes(arch)) {
    throw new Error(`Unsupported --arch "${values.arch}". Use one of: ${ARCHES.join(", ")}.`);
  }
  const version =
    values["build-version"]?.trim().replace(/^v/, "") ||
    readJson<{ version: string }>(NodePath.join(desktopDir, "package.json")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid --build-version "${version}". Expected semver like 1.2.3.`);
  }

  return {
    platform: "mac",
    target: values.target,
    arch,
    version,
    outputDir: NodePath.resolve(repoRoot, values["output-dir"]),
    skipBuild: values["skip-build"],
    keepStage: values["keep-stage"],
    signed: values.signed,
    verbose: values.verbose,
  };
}

export function resolveUpdateChannel(version: string): "latest" | "nightly" | null {
  if (/-nightly\.\d{8}\.\d+$/.test(version)) return "nightly";
  // Other prereleases (e.g. 1.2.3-rc.1) are downloaded by hand and get no feed.
  if (version.includes("-")) return null;
  return "latest";
}

export function resolvePublishConfig(version: string, env: NodeJS.ProcessEnv) {
  const channel = resolveUpdateChannel(version);
  if (!channel) return undefined;
  const repository =
    env.OTTER_MAIL_UPDATE_REPOSITORY?.trim() ||
    env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_UPDATE_REPOSITORY;
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Update repository must look like owner/repo; received "${repository}".`);
  }
  return {
    provider: "github",
    owner,
    repo,
    releaseType: channel === "nightly" ? "prerelease" : "release",
    channel,
  };
}

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
`;

export function createBuildConfig(options: {
  version: string;
  target: string;
  signed: boolean;
  electronVersion: string;
  entitlementsPath: string | undefined;
  env: NodeJS.ProcessEnv;
}): Record<string, unknown> {
  const publish = resolvePublishConfig(options.version, options.env);
  const config: Record<string, unknown> = {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    electronVersion: options.electronVersion,
    artifactName: "Otter-Mail-${version}-${arch}.${ext}",
    electronLanguages: ["en-US"],
    // Everything is bundled; there is nothing to install or rebuild.
    npmRebuild: false,
    nodeGypRebuild: false,
    files: ["package.json", "dist-electron/**/*", "renderer/**/*", "!**/*.map"],
    directories: { buildResources: "resources", output: "dist" },
    extraResources: [{ from: "bin/translator", to: "bin/translator" }],
    mac: {
      target: options.target === "dmg" ? ["dmg", "zip"] : ["zip"],
      category: "public.app-category.productivity",
      icon: "icon.icns",
      darkModeSupport: true,
      hardenedRuntime: true,
      protocols: [
        { name: "Email", schemes: ["mailto"] },
        { name: PRODUCT_NAME, schemes: ["ottermail"] },
      ],
      extendInfo: {
        LSApplicationCategoryType: "public.app-category.productivity",
        // Show new-mail notifications as banners that stay out of the way.
        NSUserNotificationAlertStyle: "banner",
      },
      ...(options.signed
        ? {
            entitlements: options.entitlementsPath,
            entitlementsInherit: options.entitlementsPath,
            // electron-builder notarizes with APPLE_API_KEY/_ID/_ISSUER.
            notarize: true,
          }
        : {
            // No Developer ID: seal the bundle ad hoc ("-"). Skipping signing
            // (identity: null) would leave Electron's stale signature after
            // electron-builder edits the bundle, which macOS reports as
            // "damaged". Hardened runtime needs a real identity.
            identity: "-",
            hardenedRuntime: false,
            notarize: false,
          }),
    },
    dmg: {
      title: `${PRODUCT_NAME} ${options.version}`,
      window: { width: 540, height: 380 },
      iconSize: 100,
      contents: [
        { x: 140, y: 190, type: "file" },
        { x: 400, y: 190, type: "link", path: "/Applications" },
      ],
    },
  };
  if (publish) config.publish = [publish];
  return config;
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; label?: string } = {},
): void {
  const label = options.label ?? [command, ...args].join(" ");
  log(`$ ${label}`);
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}.`);
}

function copyDir(from: string, to: string, filter?: (path: string) => boolean): void {
  NodeFS.cpSync(from, to, {
    recursive: true,
    ...(filter ? { filter: (source: string) => filter(source) } : {}),
  });
}

function binaryArchs(path: string): string[] {
  const result = NodeChildProcess.spawnSync("lipo", ["-archs", path], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\s+/) : [];
}

function resolveTranslatorBinary(options: Options): string {
  let binary: string | undefined;
  if (options.skipBuild) {
    binary = findTranslatorBinary("universal") ?? findTranslatorBinary("host");
    if (!binary) {
      fail(
        "No translator build found. Run `pnpm build:translator --universal` or drop --skip-build.",
      );
    }
  } else {
    log("Building native/translator (universal)...");
    try {
      binary = buildTranslator({ universal: true });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  const needed = {
    arm64: ["arm64"],
    x64: ["x86_64"],
    universal: ["arm64", "x86_64"],
    both: ["arm64", "x86_64"],
  }[options.arch];
  const present = binaryArchs(binary);
  const absent = needed.filter((arch) => !present.includes(arch));
  if (absent.length > 0) {
    fail(
      `${binary} lacks ${absent.join(", ")} (has ${present.join(", ") || "none"}). ` +
        "Run `pnpm build:translator --universal`.",
    );
  }
  return binary;
}

function builderArchFlags(arch: Arch): string[] {
  return arch === "both" ? ["--arm64", "--x64"] : [`--${arch}`];
}

function main(): void {
  let options: Options | null;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!options) {
    console.log(HELP);
    return;
  }
  if (process.platform !== "darwin") fail("macOS artifacts must be built on macOS.");

  const electronVersion = readJson<{ version: string }>(
    NodePath.join(desktopDir, "node_modules", "electron", "package.json"),
  ).version;
  const desktopPackage = readJson<{ description?: string }>(
    NodePath.join(desktopDir, "package.json"),
  );
  log(
    `Otter Mail ${options.version} for mac/${options.target} (arch=${options.arch}, ` +
      `channel=${resolveUpdateChannel(options.version) ?? "none"}, signed=${options.signed})`,
  );

  if (!options.skipBuild) {
    // Same as the packages' `build` scripts, without needing pnpm on PATH.
    run(vpBin, ["build"], { cwd: webDir, label: "(apps/web) vp build" });
    run(vpBin, ["pack"], {
      cwd: desktopDir,
      env: { ...process.env, OTTER_MAIL_VERSION: options.version },
      label: `(apps/desktop) OTTER_MAIL_VERSION=${options.version} vp pack`,
    });
  }
  const translatorBinary = resolveTranslatorBinary(options);

  const requiredInputs = [
    NodePath.join(desktopDir, "dist-electron", "main.cjs"),
    NodePath.join(desktopDir, "dist-electron", "preload.cjs"),
    NodePath.join(webDir, "dist", "index.html"),
    NodePath.join(webDir, "dist", "tray-popover.html"),
  ];
  const missing = requiredInputs.filter((path) => !NodeFS.existsSync(path));
  if (missing.length > 0) {
    fail(`Missing build output (drop --skip-build?):\n  ${missing.join("\n  ")}`);
  }

  // Stage the app directory electron-builder packages.
  const stageDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-stage-"));
  log(`Staging in ${stageDir}`);
  const notMap = (source: string) => !source.endsWith(".map");
  copyDir(
    NodePath.join(desktopDir, "dist-electron"),
    NodePath.join(stageDir, "dist-electron"),
    notMap,
  );
  copyDir(NodePath.join(webDir, "dist"), NodePath.join(stageDir, "renderer"), notMap);
  copyDir(NodePath.join(desktopDir, "resources"), NodePath.join(stageDir, "resources"));
  NodeFS.mkdirSync(NodePath.join(stageDir, "bin"));
  NodeFS.copyFileSync(translatorBinary, NodePath.join(stageDir, "bin", "translator"));
  NodeFS.chmodSync(NodePath.join(stageDir, "bin", "translator"), 0o755);

  let entitlementsPath: string | undefined;
  if (options.signed) {
    entitlementsPath = NodePath.join(stageDir, "entitlements.mac.plist");
    NodeFS.writeFileSync(entitlementsPath, ENTITLEMENTS);
  }

  const stagedPackageJson = {
    name: "otter-mail",
    productName: PRODUCT_NAME,
    version: options.version,
    description: desktopPackage.description ?? "Gmail, calm and fast.",
    author: "Otterware",
    main: "dist-electron/main.cjs",
    devDependencies: { electron: electronVersion },
    build: createBuildConfig({
      version: options.version,
      target: options.target,
      signed: options.signed,
      electronVersion,
      entitlementsPath,
      env: process.env,
    }),
  };
  NodeFS.writeFileSync(
    NodePath.join(stageDir, "package.json"),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
  );

  // electron-builder treats set-but-empty variables (CSC_LINK="") as set.
  const buildEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === "") delete buildEnv[key];
  }
  if (options.signed) {
    const required = [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
    ];
    const absent = required.filter((key) => !buildEnv[key]);
    if (absent.length > 0) fail(`--signed needs ${absent.join(", ")}.`);
  } else {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    for (const key of Object.keys(buildEnv)) {
      if (key.startsWith("CSC_") && key !== "CSC_IDENTITY_AUTO_DISCOVERY") delete buildEnv[key];
      if (key.startsWith("APPLE_")) delete buildEnv[key];
    }
  }
  if (options.verbose) {
    buildEnv.DEBUG = [
      buildEnv.DEBUG,
      "electron-builder",
      "electron-osx-sign*",
      "electron-notarize*",
    ]
      .filter(Boolean)
      .join(",");
  }

  const builderArgs = [
    "--projectDir",
    stageDir,
    "--mac",
    ...builderArchFlags(options.arch),
    "--publish",
    "never",
  ];
  run(electronBuilderBin, builderArgs, {
    env: buildEnv,
    label: `electron-builder ${builderArgs.join(" ")}`,
  });

  const distDir = NodePath.join(stageDir, "dist");
  const artifacts = NodeFS.readdirSync(distDir).filter(
    (name) =>
      /\.(dmg|zip|blockmap|yml)$/.test(name) &&
      name !== "builder-debug.yml" &&
      name !== "builder-effective-config.yaml",
  );
  if (!artifacts.some((name) => name.endsWith(".dmg") || name.endsWith(".zip"))) {
    fail(`electron-builder produced no artifacts in ${distDir}.`);
  }
  NodeFS.mkdirSync(options.outputDir, { recursive: true });
  for (const name of artifacts) {
    NodeFS.copyFileSync(NodePath.join(distDir, name), NodePath.join(options.outputDir, name));
    log(`-> ${NodePath.join(options.outputDir, name)}`);
  }

  if (options.keepStage) {
    log(`Kept stage at ${stageDir}`);
  } else {
    NodeFS.rmSync(stageDir, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
