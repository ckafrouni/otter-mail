import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ExpoConfig } from "expo/config";

type AppVariant = "development" | "production";

/**
 * Build-time config from the environment, falling back to the repo's
 * gitignored .env.local and .env (KEY=VALUE lines), like the desktop build.
 */
function buildEnv(key: string): string {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  for (const file of ["../../.env.local", "../../.env"]) {
    const path = NodePath.resolve(__dirname, file);
    if (!NodeFS.existsSync(path)) continue;
    for (const line of NodeFS.readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match?.[1] === key) return match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return "";
}

const APP_VARIANT: AppVariant =
  process.env.APP_VARIANT === "development" ? "development" : "production";

const VARIANT_CONFIG = {
  development: {
    appName: "Otter Mail Dev",
    scheme: "ottermail-dev",
    bundleIdentifier: "dev.otterware.mail.dev",
    icon: "../../assets/dev/blueprint-ios-1024.png",
  },
  production: {
    appName: "Otter Mail",
    scheme: "ottermail",
    bundleIdentifier: "dev.otterware.mail",
    icon: "../../assets/prod/otter-mail-ios-1024.png",
  },
} as const;

const variant = VARIANT_CONFIG[APP_VARIANT];

/**
 * Google OAuth "iOS" client in the otter-mail Google Cloud project. Google
 * redirects back to the app on the client id's reversed form, so that scheme
 * is registered next to the app's own.
 */
const googleIosClientId = buildEnv("OTTER_MAIL_GOOGLE_IOS_CLIENT_ID");
const googleRedirectScheme = googleIosClientId
  ? googleIosClientId.split(".").toReversed().join(".")
  : null;

const dmSansFonts = [
  "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
];

const config: ExpoConfig = {
  name: variant.appName,
  slug: "otter-mail",
  platforms: ["ios"],
  scheme: googleRedirectScheme ? [variant.scheme, googleRedirectScheme] : variant.scheme,
  version: "0.1.0",
  orientation: "portrait",
  icon: variant.icon,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: variant.bundleIdentifier,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    ["expo-font", { ios: { fonts: dmSansFonts } }],
    "expo-secure-store",
    "expo-sqlite",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: variant.icon,
        resizeMode: "contain",
        backgroundColor: "#000000",
        imageWidth: 200,
      },
    ],
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
    // The iOS 27 SDK refuses to launch apps without the UIScene life cycle.
    "./plugins/withIosSceneLifecycle.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    // Omitted when unset, not null: the embedded manifest turns null into {}.
    ...(googleIosClientId ? { googleIosClientId } : {}),
  },
};

export default config;
