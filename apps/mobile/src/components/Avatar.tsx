import { Image } from "react-native";

import { AppText as Text } from "./AppText";

/** Deterministic hue per address so people keep a stable identity color (as on desktop). */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export function Avatar(props: { name: string; email: string; picture?: string; size?: number }) {
  const size = props.size ?? 36;
  if (props.picture) {
    return (
      <Image
        source={{ uri: props.picture }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  const initial = (props.name || props.email).trim().charAt(0).toUpperCase() || "?";
  return (
    <Text
      className="overflow-hidden text-center font-t3-medium text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        lineHeight: size,
        fontSize: size * 0.42,
        backgroundColor: `hsl(${hueFor(props.email.toLowerCase())}, 45%, 52%)`,
      }}
    >
      {initial}
    </Text>
  );
}
