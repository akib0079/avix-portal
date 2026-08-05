import { toneChip, type Tone } from "@/lib/tone";
import { cn } from "@/lib/utils";

/**
 * The one status pill. Every "2 awaiting approval", "Part paid", "Lead",
 * "Waiting 4 days" chip in the app should be this — pick a tone, not a colour.
 */
export function StatusChip({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneChip[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      {children}
    </span>
  );
}
