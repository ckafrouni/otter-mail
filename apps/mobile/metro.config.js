const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");

// Workspace packages (@otter-mail/contracts) live outside this folder.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
  polyfills: { rem: 14 },
});
