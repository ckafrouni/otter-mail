import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localConfig } from "./local-config.ts";

// Keep this beside wrangler.jsonc so Wrangler still finds the developer's .dev.vars.
const config = resolve(import.meta.dirname, "../.wrangler.local.jsonc");
writeFileSync(config, localConfig());
const child = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--config", config, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
