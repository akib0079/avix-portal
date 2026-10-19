"use client";

import { useMemo, useState } from "react";
import { RequestCard } from "./request-card";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { Input } from "@/components/ui/input";
import { Lane, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { taskRequestStatusColor } from "@/lib/status-colors";
import { useLocalSet } from "@/lib/use-local-pref";
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
  // Declined only grows and is rarely reopened; it starts folded.
  const [folded, toggleFold] = useLocalSet("avix.requests.folded", ["REJECTED"]);

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
            className="h-9 bg-card pl-8 text-sm"
          />
        </div>
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <Clock className="size-3" />
            {overdue} waiting {SLA_DAYS}+ days
          </span>
        )}
      </div>

      <LaneScroller>
        {COLUMNS.map((column) => {
          const items = byStatus(column.status);
          return (
            <Lane
              key={column.status}
              color={taskRequestStatusColor[column.status]}
              title={column.label}
              count={items.length}
              hint={column.hint}
              collapsed={folded.has(column.status)}
              onToggle={() => toggleFold(column.status)}
              className="lg:min-w-[280px]"
              empty={items.length === 0 ? <LaneEmpty>Nothing here</LaneEmpty> : undefined}
            >
              <RequestColumn items={items} now={now} resetKey={search} />
            </Lane>
          );
        })}
      </LaneScroller>
    </div>
  );
}

/**
 * One column, rendered a page at a time: every card carries the full rich-text
 * description, and Approved/Declined only ever grow.
 */
function RequestColumn({
  items,
  now,
  resetKey,
}: {
  items: BoardRequest[];
  now: number;
  resetKey: string;
}) {
  const page = useProgressive(items, resetKey, 15);
  return (
    <>
      {page.shown.map((request) => {
        const waitingDays = Math.floor((now - new Date(request.createdAt).getTime()) / 86_400_000);
        return (
          <RequestCard
            key={request.id}
            request={request}
            waitingDays={waitingDays}
            stale={request.status === "PENDING" && waitingDays >= SLA_DAYS}
          />
        );
      })}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </>
  );
}
