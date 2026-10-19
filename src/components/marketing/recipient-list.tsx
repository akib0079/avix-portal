"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { HUE } from "@/lib/status-colors";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock3, XCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type RecipientRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  isLead: boolean;
  state: "delivered" | "pending" | "failed";
  error: string | null;
};

const STATE = {
  delivered: { label: "Delivered", color: HUE.green, icon: CheckCircle2 },
  pending: { label: "Pending", color: HUE.slate, icon: Clock3 },
  failed: { label: "Failed", color: HUE.red, icon: XCircle },
} as const;

const FILTERS = ["all", "delivered", "pending", "failed"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Who got it. Rows rather than a table so a phone shows name, address and
 * outcome without dropping columns; failures sort first and show why.
 */
export function RecipientList({ recipients }: { recipients: RecipientRow[] }) {
  const [filter, setFilter] = useState<Filter>(
    recipients.some((r) => r.state === "failed") ? "failed" : "all",
  );
  const [search, setSearch] = useState("");

  const counts = useMemo(
    () => ({
      all: recipients.length,
      delivered: recipients.filter((r) => r.state === "delivered").length,
      pending: recipients.filter((r) => r.state === "pending").length,
      failed: recipients.filter((r) => r.state === "failed").length,
    }),
    [recipients],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const order = { failed: 0, pending: 1, delivered: 2 };
    return recipients
      .filter((r) => filter === "all" || r.state === filter)
      .filter((r) => !needle || `${r.name} ${r.email} ${r.company ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => order[a.state] - order[b.state]);
  }, [recipients, filter, search]);

  return (
    <section className="surface flex min-w-0 flex-col overflow-hidden">
      <div className="space-y-2.5 border-b p-4 sm:p-5">
        <p className="eyebrow">Recipients · {recipients.length}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5 [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
                <span className="ml-1 opacity-70 tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
          {recipients.length > 8 && (
            <div className="relative min-w-[160px] flex-1">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a recipient"
                className="h-8 bg-card pl-8 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nobody here.</p>
      ) : (
        <ul className="max-h-[36rem] divide-y overflow-y-auto [scrollbar-width:thin]">
          {visible.map((r) => {
            const s = STATE[r.state];
            return (
              <li
                key={r.id}
                style={{ "--col": s.color } as CSSProperties}
                className="relative flex items-center gap-3 px-4 py-2.5 sm:px-5"
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-60" />
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                  {initials(r.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{r.name}</span>
                    {r.isLead && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Lead
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.email}
                    {r.company ? ` · ${r.company}` : ""}
                  </p>
                  {r.error && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-red-600 dark:text-red-400" title={r.error}>
                      {r.error}
                    </p>
                  )}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[color-mix(in_oklab,var(--col)_75%,var(--foreground))]">
                  <s.icon className="size-3.5" />
                  <span className="hidden sm:inline">{s.label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
