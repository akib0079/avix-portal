"use client";

import { useMemo, useState } from "react";
import { RequestCard } from "./request-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TaskRequestStatus } from "@prisma/client";
import { Search, Inbox, Clock } from "lucide-react";

export type BoardRequest = {
  id: string;
  title: string;
  description: unknown;
  status: TaskRequestStatus;
  adminNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  client: { id: string; firstName: string; lastName: string; company: string | null };
  project: { id: string; projectName: string };
};

const COLUMNS: { status: TaskRequestStatus; label: string; hint: string }[] = [
  { status: "PENDING", label: "Waiting on us", hint: "Approve with pricing or reject with a note" },
  { status: "APPROVED", label: "Approved", hint: "Became scheduled work" },
  { status: "REJECTED", label: "Declined", hint: "Closed with a reason" },
];

/** Requests older than this without an answer are called out. */
const SLA_DAYS = 3;

/**
 * Task requests as a board rather than one long list — the point of this page
 * is "what has a client asked for that we haven't answered", and a flat list
 * sorted by date buried that under everything already handled.
 */
export function RequestBoard({
  requests,
  now,
}: {
  requests: BoardRequest[];
  /** Server timestamp, so "waiting N days" is stable across re-renders. */
  now: number;
}) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return requests;
    return requests.filter((r) =>
      `${r.title} ${r.client.firstName} ${r.client.lastName} ${r.client.company ?? ""} ${r.project.projectName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [requests, search]);

  const byStatus = (status: TaskRequestStatus) =>
    visible.filter((r) => r.status === status);

  const overdue = byStatus("PENDING").filter(
    (r) => (now - new Date(r.createdAt).getTime()) / 86_400_000 >= SLA_DAYS,
  ).length;

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-4 font-medium">No requests yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When clients request work from the portal, it lands here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, client or project"
            className="h-9 pl-8 text-sm"
          />
        </div>
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <Clock className="size-3" />
            {overdue} waiting {SLA_DAYS}+ days
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = byStatus(column.status);
          return (
            <section key={column.status} className="min-w-0">
              <header className="mb-3">
                <h2 className="font-heading flex items-center gap-2 text-sm font-semibold">
                  {column.label}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    {items.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{column.hint}</p>
              </header>

              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                  Nothing here
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((request) => {
                    const waitingDays = Math.floor(
                      (now - new Date(request.createdAt).getTime()) / 86_400_000,
                    );
                    const stale = request.status === "PENDING" && waitingDays >= SLA_DAYS;
                    return (
                      <div
                        key={request.id}
                        className={cn(
                          "rounded-xl",
                          stale && "ring-2 ring-amber-300 dark:ring-amber-800",
                        )}
                      >
                        {stale && (
                          <p className="flex items-center gap-1 rounded-t-xl bg-amber-100 px-3 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                            <Clock className="size-3" /> Waiting {waitingDays} days
                          </p>
                        )}
                        <RequestCard request={request} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
