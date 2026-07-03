/** Deterministic hue per sender so people keep a stable identity color. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export function SenderAvatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string;
  email: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const source = (name ?? "").trim() || email;
  const initial = (source[0] ?? "?").toUpperCase();
  const hue = hueFor(email.trim().toLowerCase());
  return (
    <span
      className={[
        "shrink-0 rounded-full flex items-center justify-center font-semibold select-none",
        size === "sm" ? "size-6 text-[11px]" : "size-8 text-[13px]",
        className ?? "",
      ].join(" ")}
      style={{ backgroundColor: `hsl(${hue} 48% 52%)`, color: "#fff" }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
