import { cn } from "@/lib/utils";

/**
 * The Avix pixel robot from the marketing site — a floating, glowing mascot
 * used as an interactive accent (login page, chat launcher).
 */
export function AvixBot({
  className,
  size = 36,
  float = true,
  glow = true,
}: {
  className?: string;
  /** Width in px (height scales 12/10). */
  size?: number;
  float?: boolean;
  glow?: boolean;
}) {
  return (
    <span
      className={cn("inline-block", float && "animate-avix-float", className)}
      style={
        glow
          ? { filter: "drop-shadow(0 0 12px rgba(255, 102, 0, 0.8))" }
          : undefined
      }
      aria-hidden
    >
      <svg
        width={size}
        height={(size * 12) / 10}
        viewBox="0 0 10 12"
        fill="#ff6600"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="3" y="0" width="4" height="3" />
        <rect x="2" y="3" width="6" height="4" />
        <rect x="0" y="3" width="2" height="3" />
        <rect x="8" y="3" width="2" height="3" />
        <rect x="2" y="7" width="2" height="5" />
        <rect x="6" y="7" width="2" height="5" />
      </svg>
    </span>
  );
}
