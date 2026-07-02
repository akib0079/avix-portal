import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon,
  iconClassName,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconClassName?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-heading mt-1.5 truncate text-3xl font-bold tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            iconClassName ?? "bg-brand-tint text-primary",
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
