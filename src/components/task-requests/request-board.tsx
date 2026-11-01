"use client";

import { useMemo, useState } from "react";
import type { ProjectBillingType } from "@prisma/client";
import { RequestCard } from "./request-card";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { Input } from "@/components/ui/input";
import { Lane, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { taskRequestStatusColor } from "@/lib/status-colors";
import { useLocalSet } from "@/lib/use-local-pref";
import type { WorkRole } from "@/lib/board";
import type { RequestOutcome } from "@/lib/work-list";
import { Search, Inbox, Clock } from "lucide-react";

/** One request as the inbox shows it — the decision, and where its work is now. */
export type InboxRequest = {
  /** The TaskRequest the decision is recorded on. */
  requestId: string | null;
  /** The work item it is (or was), for the deep link. */
  itemId: string | null;
  title: string;
  /** The client's own words — waiting requests only. */
  description?: unknown;
  client: { id: string; firstName: string; lastName: string; company: string | null } | null;
  project: { id: string; projectName: string; billingType: ProjectBillingType };
  /** ISO */
  createdAt: string;
  resolvedAt: string | null;
  outcome: RequestOutcome;
  comments: number;
};

type LaneKey = "waiting" | "accepted" | "declined";

const LANES: { key: LaneKey; label: string; hint: string; color: string }[] = [
  {
    key: "waiting",
    label: "Waiting on us",
    hint: "Accept into the plan, or decline with a note",
    color: taskRequestStatusColor.PENDING,
  },
  {
    key: "accepted",
    label: "Accepted",
    hint: "In the plan — where each one is now",
    color: taskRequestStatusColor.APPROVED,
  },
  {
    key: "declined",
    label: "Declined",
    hint: "Closed with a reason, or withdrawn",
    color: taskRequestStatusColor.REJECTED,
  },
];

function laneOf(outcome: RequestOutcome): LaneKey {
  if (outcome.kind === "waiting") return "waiting";
  if (outcome.kind === "accepted" || outcome.kind === "closed") return "accepted";
  return "declined";
}

/** Requests older than this without an answer are called out. */
const SLA_DAYS = 3;

/**
 * Every project's requests as lanes — the point of this page is "what has a
 * client asked for that we haven't answered", and a flat list sorted by date
 * buried that under everything already handled. Waiting requests are
 * decided right here, with the same dialogs as the project page; every card
 * links to its item.
 */
export function RequestBoard({
  requests,
  now,
  role,
}: {
  requests: InboxRequest[];
  /** Server timestamp, so "waiting N days" is stable across re-renders. */
  now: number;
  role: WorkRole;
}) {
  const [search, setSearch] = useState("");
  // Declined only grows and is rarely reopened; it starts folded.
  const [folded, toggleFold] = useLocalSet("avix.requests.folded", ["declined"]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return requests;
    return requests.filter((r) =>
      `${r.title} ${r.client?.firstName ?? ""} ${r.client?.lastName ?? ""} ${r.client?.company ?? ""} ${r.project.projectName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [requests, search]);

  const inLane = (key: LaneKey) => visible.filter((r) => laneOf(r.outcome) === key);
  const overdue = inLane("waiting").filter(
    (r) => (now - new Date(r.createdAt).getTime()) / 86_400_000 >= SLA_DAYS,
  ).length;

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-4 font-medium">No requests yet</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          When a client asks for something new — from their project page or the portal — it waits here
          and at the top of that project&apos;s Milestones.
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
        {LANES.map((lane) => {
          const items = inLane(lane.key);
          return (
            <Lane
              key={lane.key}
              color={lane.color}
              title={lane.label}
              count={items.length}
              hint={lane.hint}
              collapsed={folded.has(lane.key)}
              onToggle={() => toggleFold(lane.key)}
              className="lg:min-w-[280px]"
              empty={
                items.length === 0 ? (
                  <LaneEmpty>{lane.key === "waiting" ? "Nothing waiting — all answered" : "Nothing here"}</LaneEmpty>
                ) : undefined
              }
            >
              <RequestColumn items={items} now={now} resetKey={search} role={role} />
            </Lane>
          );
        })}
      </LaneScroller>
    </div>
  );
}

/** One lane, a page at a time: Accepted and Declined only ever grow. */
function RequestColumn({
  items,
  now,
  resetKey,
  role,
}: {
  items: InboxRequest[];
  now: number;
  resetKey: string;
  role: WorkRole;
}) {
  const page = useProgressive(items, resetKey, 15);
  return (
    <>
      {page.shown.map((request) => {
        const waitingDays = Math.floor((now - new Date(request.createdAt).getTime()) / 86_400_000);
        return (
          <RequestCard
            key={request.requestId ?? request.itemId}
            request={request}
            waitingDays={waitingDays}
            stale={request.outcome.kind === "waiting" && waitingDays >= SLA_DAYS}
            role={role}
          />
        );
      })}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </>
  );
}
