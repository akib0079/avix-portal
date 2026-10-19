import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The board's two pill shapes, for every status in the admin. Pass a colour
 * from `@/lib/status-colors` rather than a class: the colour is mixed, so
 * one value gives the right shade in light and dark.
 */

/** Solid pill with white text — a lane's title, as on the project board. */
export function LanePill({
  color,
  children,
  className,
}: {
  color: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-sm",
        className,
      )}
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/**
 * Tinted pill with a dot — a status inside a row or a card, where a solid
 * pill would shout. The text is the hue pulled toward the foreground, which
 * keeps it readable on both themes (pure #f59e0b on white fails contrast).
 */
export function SoftPill({
  color,
  children,
  className,
  strike,
}: {
  color: string;
  children: React.ReactNode;
  className?: string;
  /** Cancelled things: struck through, but still legible. */
  strike?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        "bg-[color-mix(in_oklab,var(--c)_13%,transparent)] text-[color-mix(in_oklab,var(--c)_72%,var(--foreground))]",
        strike && "line-through decoration-1",
        className,
      )}
      style={{ "--c": color } as CSSProperties}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--c)]" />
      {children}
    </span>
  );
}
