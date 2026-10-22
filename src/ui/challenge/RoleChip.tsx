/** who says the line in a conversation: 相手 in the model's cyan (a voice you listen to), あなた in yellow */
export default function RoleChip({ role, size = "sm" }: { role: "partner" | "you"; size?: "sm" | "md" }) {
  const you = role === "you";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-(--ink) ${size === "md" ? "h-8 px-3 text-[14px]" : "h-6 min-w-[46px] px-2 text-[12px]"}`}
      style={you ? { background: "var(--voice)" } : { background: "color-mix(in srgb, var(--guide) 32%, white)", boxShadow: "inset 0 0 0 1.5px var(--guide-ink)" }}
    >
      {you ? "あなた" : "相手"}
    </span>
  );
}
