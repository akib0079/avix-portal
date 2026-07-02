import { cn } from "@/lib/utils";

export function ProjectProgress({
  milestones,
  className,
}: {
  milestones: { status: string }[];
  className?: string;
}) {
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "COMPLETED").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {done} of {total} milestones complete
        </span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
