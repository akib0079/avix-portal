"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ClientHealth } from "@/lib/dal/users";
import { ClientActions } from "@/components/clients/client-actions";
import { UserStatusBadge, InviteBadge } from "@/components/status-badges";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HUE } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toneText } from "@/lib/tone";
import { Search, FolderKanban, Banknote, MessagesSquare, Mail, Building2 } from "lucide-react";

export type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  emailVerified: boolean;
  projects: number;
  liveProjects: number;
  health: ClientHealth;
  healthReason: string | null;
  owedUsd: number;
  owedUnconverted: number;
  /** Days since the last message either way; null when they never wrote. */
  lastContactDays: number | null;
};

type LaneId = "overdue" | "nudge" | "invited" | "healthy" | "inactive";

const LANES: { id: LaneId; title: string; color: string; hint: string }[] = [
  { id: "overdue", title: "Overdue 7+ days", color: HUE.red, hint: "Chase the payment" },
  {
    id: "nudge",
    title: "Needs a nudge",
    color: HUE.amber,
    hint: "Overdue invoice, or a live project gone quiet",
  },
  { id: "invited", title: "Invited", color: HUE.blue, hint: "Hasn't signed in yet" },
  { id: "healthy", title: "Healthy", color: HUE.green, hint: "Paid up and in touch" },
  { id: "inactive", title: "Inactive", color: HUE.slate, hint: "Portal access switched off" },
];

const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l])) as Record<
  LaneId,
  (typeof LANES)[number]
>;

/**
 * Where a client sits. Money trouble outranks everything — an overdue
 * client who also never signed in is an overdue client first.
 */
function laneOf(c: ClientRow): LaneId {
  if (c.status === "INACTIVE") return "inactive";
  if (c.health === "red") return "overdue";
  if (c.health === "amber") return "nudge";
  if (!c.emailVerified) return "invited";
  return "healthy";
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "invited", label: "Invited" },
  { value: "inactive", label: "Inactive" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function contactLabel(days: number | null): string {
  if (days === null) return "No messages yet";
  if (days === 0) return "Spoke today";
  if (days === 1) return "Spoke yesterday";
  return `${days}d since contact`;
}

/**
 * The client list, as a board by relationship health. The table only had a
 * coloured dot for health and nothing about money or contact; the board
 * answers "who needs me" at a glance — who owes, who has gone quiet, who
 * never signed in — and the list keeps the dense view with the same facts.
 */
export function ClientsView({ clients }: { clients: ClientRow[] }) {
  const [view, setView] = useLocalChoice("avix.clients.view", "board", VIEW_MODES);
  const [folded, toggleFold] = useLocalSet("avix.clients.folded", ["inactive"]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const lanes = clients.map(laneOf);
    return {
      all: clients.length,
      attention: lanes.filter((l) => l === "overdue" || l === "nudge").length,
      invited: lanes.filter((l) => l === "invited").length,
      inactive: lanes.filter((l) => l === "inactive").length,
    };
  }, [clients]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients.filter((c) => {
      const lane = laneOf(c);
      if (filter === "attention" && lane !== "overdue" && lane !== "nudge") return false;
      if (filter === "invited" && lane !== "invited") return false;
      if (filter === "inactive" && lane !== "inactive") return false;
      if (!needle) return true;
      return `${c.firstName} ${c.lastName} ${c.company ?? ""} ${c.email}`
        .toLowerCase()
        .includes(needle);
    });
  }, [clients, search, filter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company or email"
            className="h-9 bg-card pl-8 text-sm"
          />
        </div>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1 opacity-60 tabular-nums">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card/60 py-10 text-center text-sm text-muted-foreground">
          Nothing matches those filters.
        </p>
      ) : view === "board" ? (
        <LaneScroller>
          {LANES.map((lane) => {
            const rows = visible.filter((c) => laneOf(c) === lane.id);
            const owed = rows.reduce((sum, c) => sum + c.owedUsd, 0);
            return (
              <ClientLane
                key={lane.id}
                lane={lane}
                rows={rows}
                owed={owed}
                folded={folded.has(lane.id)}
                onToggle={() => toggleFold(lane.id)}
              />
            );
          })}
        </LaneScroller>
      ) : (
        <ClientTable rows={visible} />
      )}
    </div>
  );
}

function ClientLane({
  lane,
  rows,
  owed,
  folded,
  onToggle,
}: {
  lane: (typeof LANES)[number];
  rows: ClientRow[];
  owed: number;
  folded: boolean;
  onToggle: () => void;
}) {
  const page = useProgressive(rows, lane.id, 24);
  return (
    <Lane
      color={lane.color}
      title={lane.title}
      count={rows.length}
      meta={
        owed > 0 ? <span title="Still owed by clients in this lane, in USD">{usdWhole.format(owed)}</span> : undefined
      }
      hint={lane.hint}
      collapsed={folded}
      onToggle={onToggle}
      className="lg:min-w-[200px]"
      empty={rows.length === 0 ? <LaneEmpty>Nobody here</LaneEmpty> : undefined}
    >
      {page.shown.map((c) => (
        <ClientCard key={c.id} client={c} />
      ))}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </Lane>
  );
}

function ClientCard({ client }: { client: ClientRow }) {
  const lane = LANE_BY_ID[laneOf(client)];
  const name = `${client.firstName} ${client.lastName}`.trim();

  return (
    <article
      style={{ "--col": lane.color } as CSSProperties}
      className="group/card relative overflow-hidden rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-xs font-semibold text-white shadow-sm">
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/clients/${client.id}`}
            className="line-clamp-2 text-[13px] leading-snug font-semibold hover:text-primary [overflow-wrap:anywhere]"
          >
            {name}
          </Link>
          {client.company && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Building2 className="size-3 shrink-0" />
              <span className="truncate">{client.company}</span>
            </p>
          )}
        </div>
        <div className="-mt-1.5 -mr-1.5 shrink-0">
          <ClientActions
            client={{
              id: client.id,
              name,
              status: client.status,
              emailVerified: client.emailVerified,
            }}
          />
        </div>
      </div>

      {client.healthReason && (
        <p
          className={cn(
            "mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-snug font-medium",
            client.health === "red"
              ? "bg-red-500/12 text-red-600 dark:text-red-400"
              : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
          )}
        >
          {client.healthReason}
        </p>
      )}

      <a
        href={`mailto:${client.email}`}
        className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-primary"
      >
        <Mail className="size-3 shrink-0" />
        <span className="truncate">{client.email}</span>
      </a>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
        <span
          className="inline-flex items-center gap-1"
          title={`${client.liveProjects} live of ${client.projects} project${client.projects === 1 ? "" : "s"}`}
        >
          <FolderKanban className="size-3" />
          {client.projects} project{client.projects === 1 ? "" : "s"}
          {client.liveProjects > 0 && ` · ${client.liveProjects} live`}
        </span>
        {(client.owedUsd > 0 || client.owedUnconverted > 0) && (
          <span
            className={cn("inline-flex items-center gap-1 font-medium", toneText.warn)}
            title={
              client.owedUnconverted > 0
                ? `${client.owedUnconverted} open invoice${client.owedUnconverted === 1 ? " has" : "s have"} no USD value yet and ${client.owedUnconverted === 1 ? "isn't" : "aren't"} in this figure`
                : "Still owed across open invoices, in USD"
            }
          >
            <Banknote className="size-3" />
            {usdWhole.format(client.owedUsd)}
            {client.owedUnconverted > 0 && ` +${client.owedUnconverted}`}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <MessagesSquare className="size-3" />
          {contactLabel(client.lastContactDays)}
        </span>
      </div>
    </article>
  );
}

function ClientTable({ rows }: { rows: ClientRow[] }) {
  const page = useProgressive(rows, "list", 40);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="hidden md:table-cell">Company</TableHead>
              <TableHead className="hidden sm:table-cell">Projects</TableHead>
              <TableHead className="hidden lg:table-cell">Owes</TableHead>
              <TableHead className="hidden lg:table-cell">Last contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.shown.map((client) => {
              const lane = LANE_BY_ID[laneOf(client)];
              const name = `${client.firstName} ${client.lastName}`.trim();
              return (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link
                      href={`/admin/clients/${client.id}`}
                      className="flex items-center gap-2 font-medium hover:text-primary"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: lane.color }}
                        title={client.healthReason ?? lane.title}
                      />
                      {name}
                    </Link>
                    <p className="pl-4 text-xs text-muted-foreground">{client.email}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {client.company ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {client.projects}
                    {client.liveProjects > 0 && (
                      <span className="text-muted-foreground"> · {client.liveProjects} live</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {client.owedUsd > 0 ? (
                      <span className={toneText.warn}>{usdWhole.format(client.owedUsd)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {contactLabel(client.lastContactDays)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <UserStatusBadge status={client.status} />
                      <InviteBadge emailVerified={client.emailVerified} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <ClientActions
                      client={{
                        id: client.id,
                        name,
                        status: client.status,
                        emailVerified: client.emailVerified,
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
      </CardContent>
    </Card>
  );
}
