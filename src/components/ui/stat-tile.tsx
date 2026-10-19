import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * A headline figure on a raised surface. The icon chip carries the colour
 * (from lib/status-colors), so a row of these reads at a glance and matches
 * the lanes below it. Two to a row on a phone, four from xl.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  color,
  i = 0,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** A quiet line under the label. */
  sub?: React.ReactNode;
  color: string;
  /** Stagger index for the entrance. */
  i?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("surface rise min-w-0 p-4 sm:p-5", className)}
      style={{ "--c": color, "--i": i } as CSSProperties}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--c)_13%,transparent)] text-[color-mix(in_oklab,var(--c)_80%,var(--foreground))]">
        <Icon className="size-[18px]" />
      </span>
      <p className="num mt-3 truncate text-2xl font-bold sm:mt-4 sm:text-3xl">{value}</p>
      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
