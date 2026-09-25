"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_RANGES, rangeLabels, type DashboardRange } from "@/lib/dashboard-ranges";
import { cn } from "@/lib/utils";

/**
 * Switching range re-renders the dashboard on the server. Before, the click
 * did nothing visible until the new page arrived, so it felt broken on a slow
 * connection. Now the pill moves at once, the figures that depend on the
 * range dim (`.range-sensitive`), and a hairline sweeps the top — all driven
 * by one transition shared through this scope.
 */

type RangeCtx = { pending: boolean; go: (href: string) => void };
const Ctx = createContext<RangeCtx | null>(null);

export function RangeScope({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => start(() => router.push(href, { scroll: false }));
  return (
    <Ctx.Provider value={{ pending, go }}>
      <div data-pending={pending || undefined} className="relative">
        {pending && (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-[progress-sweep_900ms_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
          </div>
        )}
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function RangeSwitcher({ active }: { active: DashboardRange }) {
  const ctx = useContext(Ctx);
  const params = useSearchParams();
  // Moves on click; falls back to the server's answer once it lands.
  const [chosen, setChosen] = useState<DashboardRange | null>(null);
  const shown = ctx?.pending && chosen ? chosen : active;
  const index = DASHBOARD_RANGES.indexOf(shown);

  function pick(range: DashboardRange) {
    if (range === shown) return;
    setChosen(range);
    const next = new URLSearchParams(params.toString());
    if (range === "month") next.delete("range");
    else next.set("range", range);
    const qs = next.toString();
    ctx?.go(qs ? `/admin?${qs}` : "/admin");
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard period"
      className="surface relative grid w-full grid-cols-4 rounded-full p-1 sm:w-auto"
    >
      {/* Sliding thumb: one element translated, not four re-styled. */}
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full bg-foreground shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {DASHBOARD_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={shown === r}
          onClick={() => pick(r)}
          className={cn(
            "relative z-10 rounded-full px-1.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors sm:px-3 sm:text-xs",
            shown === r ? "text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rangeLabels[r]}
        </button>
      ))}
    </div>
  );
}
