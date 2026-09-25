import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import * as NodeURL from "node:url";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const port = Number(process.env.PORT ?? 5833);

export default defineConfig({
  // Built files are loaded from disk (file://) by the Electron shell.
  base: "./",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  define: {
    __APP_DISPLAY_NAME__: JSON.stringify("Otter Mail"),
  },
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port,
    strictPort: true,
    host: "localhost",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: NodeURL.fileURLToPath(new URL("./index.html", import.meta.url)),
        "tray-popover": NodeURL.fileURLToPath(new URL("./tray-popover.html", import.meta.url)),
      },
    },
  },
});
