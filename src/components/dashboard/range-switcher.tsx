"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_RANGES, rangeLabels, type DashboardRange } from "@/lib/dashboard-ranges";
import { cn } from "@/lib/utils";

/** Switches the dashboard's money/time window via ?range= (server re-renders). */
export function RangeSwitcher({ active }: { active: DashboardRange }) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(range: DashboardRange) {
    const next = new URLSearchParams(params.toString());
    if (range === "month") next.delete("range");
    else next.set("range", range);
    const qs = next.toString();
    router.push(qs ? `/admin?${qs}` : "/admin");
  }

  return (
    <div className="flex flex-wrap gap-1 rounded-full border bg-card p-1">
      {DASHBOARD_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => pick(r)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            active === r
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {rangeLabels[r]}
        </button>
      ))}
    </div>
  );
}
