#!/usr/bin/env node
// `pnpm dev`: the web dev server, the main-process bundler in watch mode, and
// Electron (restarted on main/preload changes), with one Ctrl-C for all three.
//
// Ports: 5833 in the main checkout. Linked git worktrees get a stable offset
// hashed from their path so several checkouts can run side by side.
// Override with OTTER_MAIL_PORT_OFFSET=<n> or PORT=<port>.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { parseArgs } from "node:util";

import { resolveDevHome, resolveLinkedWorktree } from "../apps/desktop/scripts/dev-home.mjs";
import { buildTranslator, findTranslatorBinary, repoRoot } from "./build-translator.ts";

const BASE_WEB_PORT = 5833;
const MAX_HASH_OFFSET = 3000;
const SHUTDOWN_GRACE_MS = 3_000;

const HELP = `Usage: pnpm dev [-- options]

Starts the Vite dev server (apps/web), \`vp pack --watch\` (apps/desktop), and
Electron against them. Ctrl-C stops everything.

Options:
  --home <dir>    Data home for this run. Default: a linked worktree's own
                  .otter-mail, otherwise ~/.otter-mail/dev (never the installed
                  app's ~/.otter-mail/userdata).
  --no-electron   Only run the web dev server and the main-process bundler.
  --dry-run       Print the resolved port and commands, then exit.
  -h, --help      Show this help.

Environment:
  OTTER_MAIL_HOME         Data home, same as --home.
  OTTER_MAIL_REMOTE_DEBUGGING_PORT
                          Chrome DevTools port of the dev app (default: dev server
                          port + 1000; 0 turns it off). Playwright and agents attach
                          here with connectOverCDP.
  PORT                    Exact dev server port.
  OTTER_MAIL_PORT_OFFSET  Offset added to ${BASE_WEB_PORT} (default: hashed from the
                          worktree path in linked worktrees, 0 otherwise).
`;

export function hashOffset(seed: string): number {
  const digest = NodeCrypto.createHash("sha256").update(seed).digest();
  return (digest.readUInt32BE(0) % MAX_HASH_OFFSET) + 1;
}

/** Linked worktrees have a `.git` file (not directory) pointing at the main repo. */
export function resolvePortOffset(
  env: NodeJS.ProcessEnv,
  root: string,
): { offset: number; source: string } {
  const raw = env.OTTER_MAIL_PORT_OFFSET?.trim();
  if (raw) {
    const offset = Number(raw);
    if (!Number.isInteger(offset) || offset < 0 || BASE_WEB_PORT + offset > 65535) {
      throw new Error(`OTTER_MAIL_PORT_OFFSET must be a non-negative integer; received "${raw}".`);
    }
    return { offset, source: `OTTER_MAIL_PORT_OFFSET=${offset}` };
  }
  if (resolveLinkedWorktree(root)) return { offset: hashOffset(root), source: `worktree ${root}` };
  return { offset: 0, source: "default port" };
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = NodeNet.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < Math.min(start + 100, 65536); port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free dev server port between ${start} and ${start + 99}.`);
}

function ensureTranslator(): void {
  if (findTranslatorBinary("host") || findTranslatorBinary("universal")) return;
  console.log("[dev] Building native/translator (first run only)...");
  try {
    console.log(`[dev] Translator ready: ${buildTranslator({ universal: false, quiet: true })}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[dev] Skipping the translator; in-app translation will be unavailable.\n${message}`,
    );
  }
}

const COLORS = ["\u001b[36m", "\u001b[35m", "\u001b[33m"];
const RESET = "\u001b[0m";

interface Task {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      "no-electron": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const explicitPort = process.env.PORT?.trim();
  let port: number;
  let portSource: string;
  if (explicitPort) {
    port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`PORT must be a valid port number; received "${explicitPort}".`);
    }
    portSource = `PORT=${port}`;
  } else {
    const { offset, source } = resolvePortOffset(process.env, repoRoot);
    const preferred = BASE_WEB_PORT + offset;
    port = values["dry-run"] ? preferred : await findFreePort(preferred);
    portSource = port === preferred ? source : `${source}; ${preferred} was busy`;
  }
  const devServerUrl = `http://localhost:${port}`;

  const vp = NodePath.join(repoRoot, "node_modules", ".bin", "vp");
  const tasks: Task[] = [
    { name: "web", command: vp, args: ["dev"], cwd: NodePath.join(repoRoot, "apps/web") },
    {
      name: "pack",
      command: vp,
      args: ["pack", "--watch"],
      cwd: NodePath.join(repoRoot, "apps/desktop"),
    },
  ];
  if (!values["no-electron"]) {
    tasks.push({
      name: "electron",
      command: process.execPath,
      args: ["scripts/dev-electron.mjs"],
      cwd: NodePath.join(repoRoot, "apps/desktop"),
    });
  }

  const dataHome = resolveDevHome({ cwd: repoRoot, explicitHome: values.home });
  const configuredDebugPort = process.env.OTTER_MAIL_REMOTE_DEBUGGING_PORT?.trim();
  const debugPort =
    configuredDebugPort !== undefined && configuredDebugPort !== ""
      ? Number(configuredDebugPort)
      : values["dry-run"]
        ? port + 1000
        : await findFreePort(port + 1000);
  console.log(`[dev] ${devServerUrl} (${portSource})`);
  console.log(
    `[dev] Data: ${dataHome ? NodePath.join(dataHome, "userdata") : "~/.otter-mail/dev"}`,
  );
  if (debugPort > 0) console.log(`[dev] DevTools: http://127.0.0.1:${debugPort}`);
  if (values["dry-run"]) {
    for (const task of tasks) {
      console.log(
        `[dev] ${task.name}: (cd ${task.cwd} && ${[task.command, ...task.args].join(" ")})`,
      );
    }
    return;
  }
  if (!NodeFS.existsSync(vp)) throw new Error("vite-plus is not installed. Run `pnpm install`.");

  stopLeftoverGroups();
  ensureTranslator();
  // A stale bundle would let Electron start before the first fresh build.
  NodeFS.rmSync(NodePath.join(repoRoot, "apps/desktop/dist-electron"), {
    recursive: true,
    force: true,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OTTER_MAIL_HOME: dataHome,
    OTTER_MAIL_REMOTE_DEBUGGING_PORT: String(debugPort),
    PORT: String(port),
    VITE_DEV_SERVER_URL: devServerUrl,
    FORCE_COLOR: process.env.FORCE_COLOR ?? (process.stdout.isTTY ? "1" : "0"),
  };

  const children = new Map<string, NodeChildProcess.ChildProcess>();
  let shuttingDown = false;

  const shutdown = async (exitCode: number): Promise<never> => {
    if (!shuttingDown) {
      shuttingDown = true;
      const running = [...children.values()].filter((child) => child.exitCode === null);
      const exited = running.map(
        (child) => new Promise<void>((resolve) => child.once("exit", () => resolve())),
      );
      for (const child of running) signalGroup(child, "SIGTERM");
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
      await Promise.race([Promise.all(exited), timeout]);
      for (const child of children.values()) signalGroup(child, "SIGKILL");
    }
    process.exit(exitCode);
  };

  tasks.forEach((task, index) => {
    const prefix = `${COLORS[index % COLORS.length]}[${task.name}]${RESET} `;
    // Detached: each task gets its own process group, so the terminal's Ctrl-C
    // reaches only this runner, which then stops every group in order.
    const child = NodeChildProcess.spawn(task.command, task.args, {
      cwd: task.cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(task.name, child);
    for (const stream of [child.stdout, child.stderr]) {
      const target = stream === child.stderr ? process.stderr : process.stdout;
      NodeReadline.createInterface({ input: stream }).on("line", (line) => {
        target.write(`${prefix}${line}\n`);
      });
    }
    child.once("error", (error) => {
      console.error(`${prefix}failed to start: ${error.message}`);
      void shutdown(1);
    });
    child.once("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`${prefix}exited (${signal ?? code}); stopping dev.`);
      void shutdown(code ?? 1);
    });
  });

  recordGroups([...children.values()].flatMap((child) => (child.pid ? [child.pid] : [])));

  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
  process.once("SIGHUP", () => void shutdown(129));
}

// A runner killed outright (SIGKILL, a closed terminal tab) can't stop its
// detached task groups; the next run finds them in this file and stops them,
// so the dev server port is free again.
const groupsFile = NodePath.join(repoRoot, "apps/desktop/.electron-runtime/dev-groups.json");

function recordGroups(pids: number[]): void {
  NodeFS.mkdirSync(NodePath.dirname(groupsFile), { recursive: true });
  NodeFS.writeFileSync(groupsFile, JSON.stringify(pids));
}

function stopLeftoverGroups(): void {
  let pids: number[] = [];
  try {
    pids = JSON.parse(NodeFS.readFileSync(groupsFile, "utf8")) as number[];
  } catch {
    return;
  }
  for (const pid of pids) {
    // Only groups that still look like ours: the pid may have been reused.
    const command = NodeChildProcess.spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    }).stdout;
    if (!/vite-plus|dev-electron\.mjs/.test(command)) continue;
    console.log(`[dev] Stopping leftovers from an earlier run (pid ${pid})`);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  NodeFS.rmSync(groupsFile, { force: true });
}

/** Signals the task's whole process group, so grandchildren (esbuild, Electron) go too. */
function signalGroup(child: NodeChildProcess.ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
