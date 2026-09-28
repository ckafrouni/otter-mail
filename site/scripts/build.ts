// Assembles the site in dist/: the landing pages (public/) and the web app
// (apps/web's build, its page as app.html). Run by `pnpm build` (and deploy).

import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const site = NodePath.resolve(import.meta.dirname, "..");
const web = NodePath.resolve(site, "../apps/web/dist");
const dist = NodePath.join(site, "dist");

execFileSync("pnpm", ["--filter", "@otter-mail/web", "build"], { cwd: site, stdio: "inherit" });

NodeFS.rmSync(dist, { recursive: true, force: true });
NodeFS.cpSync(NodePath.join(site, "public"), dist, { recursive: true });
NodeFS.cpSync(NodePath.join(web, "assets"), NodePath.join(dist, "assets"), { recursive: true });
NodeFS.copyFileSync(NodePath.join(web, "index.html"), NodePath.join(dist, "app.html"));
console.log("Site assembled in site/dist.");
