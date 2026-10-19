"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { CampaignStatus } from "@prisma/client";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { SoftPill } from "@/components/ui/status-pill";
import { Input } from "@/components/ui/input";
import { HUE, campaignStatusColor } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { cn } from "@/lib/utils";
import { CalendarClock, ChevronRight, Mail, Search, Send, Users } from "lucide-react";

export type CampaignRow = {
  id: string;
  subject: string;
  /** Internal label, when the subject alone doesn't say which one it is. */
  name: string | null;
  status: CampaignStatus;
  /** Pre-formatted on the server, in the agency's zone. */
  whenLabel: string;
  recipients: number;
  delivered: number;
  failed: number;
};

/**
 * Where a campaign is. QUEUED and SENDING are one lane: to whoever is
 * looking, both mean "going out now" — the difference is the drain's.
 */
type LaneId = "draft" | "scheduled" | "sending" | "sent" | "failed";

const LANES: { id: LaneId; title: string; color: string; hint: string }[] = [
  { id: "draft", title: "Draft", color: HUE.slate, hint: "Not scheduled yet" },
  { id: "scheduled", title: "Scheduled", color: HUE.violet, hint: "Goes out on its date" },
  { id: "sending", title: "Sending", color: HUE.blue, hint: "Going out now" },
  { id: "sent", title: "Sent", color: HUE.green, hint: "Delivered" },
  { id: "failed", title: "Needs retry", color: HUE.red, hint: "Some emails didn't go" },
];

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Needs retry",
};

function laneOf(status: CampaignStatus): LaneId {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "SCHEDULED":
      return "scheduled";
    case "QUEUED":
    case "SENDING":
      return "sending";
    case "SENT":
      return "sent";
    case "FAILED":
      return "failed";
  }
}

/** Delivered, failed and still-to-go, as one bar. */
function DeliveryBar({ c, className }: { c: CampaignRow; className?: string }) {
  const total = Math.max(c.recipients, 1);
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span className="h-full bg-emerald-500" style={{ width: `${(c.delivered / total) * 100}%` }} />
      <span className="h-full bg-red-500" style={{ width: `${(c.failed / total) * 100}%` }} />
    </div>
  );
}

/**
 * Campaigns on the board: what's drafted, what's lined up, what's out and
 * what needs another go. Nothing drags — every step here sends email, so it
 * happens on the campaign's own page where the send controls are.
 */
export function CampaignsView({ campaigns }: { campaigns: CampaignRow[] }) {
  const [view, setView] = useLocalChoice("avix.campaigns.view", "board", VIEW_MODES);
  const [folded, toggleFold] = useLocalSet("avix.campaigns.folded", []);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return campaigns;
    return campaigns.filter((c) => `${c.subject} ${c.name ?? ""}`.toLowerCase().includes(needle));
  }, [campaigns, search]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject or name"
            className="h-9 bg-card pl-8 text-sm"
          />
        </div>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card/60 py-10 text-center text-sm text-muted-foreground">
          Nothing matches that.
        </p>
      ) : view === "board" ? (
        <LaneScroller>
          {LANES.map((lane) => {
            const rows = visible.filter((c) => laneOf(c.status) === lane.id);
            const emails = rows.reduce((sum, c) => sum + c.recipients, 0);
            return (
              <Lane
                key={lane.id}
                color={lane.color}
                title={lane.title}
                count={rows.length}
                meta={
                  emails > 0 ? (
                    <span className="inline-flex items-center gap-1" title={`${emails} emails in this lane`}>
                      <Mail className="size-3" />
                      {emails.toLocaleString("en-US")}
                    </span>
                  ) : undefined
                }
                hint={lane.hint}
                collapsed={folded.has(lane.id)}
                onToggle={() => toggleFold(lane.id)}
                className="lg:min-w-[200px]"
                empty={rows.length === 0 ? <LaneEmpty>Nothing here</LaneEmpty> : undefined}
              >
                {rows.map((c) => (
                  <CampaignCard key={c.id} c={c} />
                ))}
              </Lane>
            );
          })}
        </LaneScroller>
      ) : (
        <div className="surface divide-y overflow-hidden">
          {visible.map((c) => (
            <Link
              key={c.id}
              href={`/admin/marketing/${c.id}`}
              style={{ "--col": campaignStatusColor[c.status] } as CSSProperties}
              className="group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5"
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.subject}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.name ? `${c.name} · ` : ""}
                  {c.whenLabel}
                </p>
              </div>
              <div className="hidden w-40 shrink-0 sm:block">
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {c.delivered} / {c.recipients} delivered
                </p>
                <DeliveryBar c={c} className="mt-1" />
              </div>
              <SoftPill color={campaignStatusColor[c.status]}>{STATUS_LABEL[c.status]}</SoftPill>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCard({ c }: { c: CampaignRow }) {
  const lane = LANES.find((l) => l.id === laneOf(c.status))!;
  const showDelivery = c.status !== "DRAFT" && c.status !== "SCHEDULED";
  return (
    <Link
      href={`/admin/marketing/${c.id}`}
      style={{ "--col": lane.color } as CSSProperties}
      className="group/card relative block overflow-hidden rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 outline-none hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
      <p className="line-clamp-2 text-[13px] leading-snug font-semibold [overflow-wrap:anywhere]">
        {c.subject}
      </p>
      {c.name && <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.name}</p>}
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        {c.status === "SCHEDULED" ? (
          <CalendarClock className="size-3 shrink-0" />
        ) : (
          <Send className="size-3 shrink-0" />
        )}
        <span className="truncate">{c.whenLabel}</span>
      </p>
      {showDelivery ? (
        <>
          <DeliveryBar c={c} className="mt-2.5" />
          <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
            {c.delivered}/{c.recipients} delivered
            {c.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {c.failed} failed</span>}
          </p>
        </>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <Users className="size-3" />
          {c.recipients} recipient{c.recipients === 1 ? "" : "s"}
        </p>
      )}
    </Link>
  );
}
