import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "**/.build/**"],
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "release",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "native/*/.build/**",
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      "apps/mobile/uniwind-types.d.ts",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "release",
      "node_modules",
      "native/*/.build/**",
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      "apps/mobile/uniwind-types.d.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
    },
  },
});
