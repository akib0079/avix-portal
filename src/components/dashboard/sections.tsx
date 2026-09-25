import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  getBusinessHealth,
  getDashboardKpis,
  getDashboardLists,
  getTodayItems,
  monthsInRange,
  type TodayItem,
} from "@/lib/dal/dashboard";
import { rangeLabels, type DashboardRange } from "@/lib/dashboard-ranges";
import { getPipelineSummary } from "@/lib/dal/leads";
import { listActivity } from "@/lib/dal/activity";
import { usd, projectTypeLabels, initials } from "@/lib/format";
import { formatCurrency } from "@/lib/currency";
import { serverNow } from "@/lib/server-now";
import { ProjectStatusBadge } from "@/components/status-badges";
import { StatusRing, TargetDial, TrendArea, compactMoney } from "@/components/dashboard/instruments";
import { ACTIVITY_META } from "@/components/dashboard/activity-feed";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Clock,
  FileSignature,
  FolderKanban,
  Hourglass,
  Inbox,
  MessagesSquare,
  Receipt,
  Repeat,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

/* ================================================================== */
/* 01 — Command deck                                                   */
/* ================================================================== */

export async function CommandDeck({ range }: { range: DashboardRange }) {
  const [k, health] = await Promise.all([getDashboardKpis(range), getBusinessHealth()]);
  const months = monthsInRange(range);
  const target = k.target * months;
  const pct = target > 0 ? Math.round((k.collected / target) * 100) : null;
  const collectionRate = k.invoiced > 0 ? Math.round((k.collected / k.invoiced) * 100) : null;
  const overdue =
    k.money.aging.current.amount + k.money.aging.thirty.amount + k.money.aging.sixtyPlus.amount;

  return (
    <section
      aria-label="Revenue overview"
      className="deck rise range-sensitive p-6 sm:p-8 lg:col-span-8"
    >
      <span className="deck-edge" aria-hidden />
      <div className="relative z-[2] grid gap-8 md:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="min-w-0">
          <p className="eyebrow text-white/50">Collected · {rangeLabels[range]}</p>
          <p className="num mt-3 text-5xl font-bold sm:text-6xl">{usd.format(k.collected)}</p>
          <p className="mt-2 text-sm text-white/55">
            of {usd.format(k.invoiced)} invoiced
            {collectionRate !== null && (
              <>
                <span className="mx-2 text-white/25">·</span>
                <span className="text-white/80">{collectionRate}%</span> collection rate
              </>
            )}
          </p>

          <div className="mt-7">
            <TrendArea points={health.trend} className="h-24 sm:h-28" />
            <div className="mt-2 flex justify-between text-[10px] font-medium tracking-wider text-white/35 uppercase">
              {health.trend.map((p, i) => (
                <span
                  key={p.label}
                  title={`${p.label}: ${usd.format(p.amount)}`}
                  className={cn(i === health.trend.length - 1 && "text-white/80")}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Target dial */}
        <div className="relative mx-auto size-52 self-center">
          <TargetDial value={k.collected} target={target} className="size-full" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {pct !== null ? (
              <>
                <span className="num text-4xl font-bold">
                  {pct}
                  <span className="text-lg text-white/50">%</span>
                </span>
                <span className="mt-1 text-[11px] text-white/50">
                  of {compactMoney(target)} target
                </span>
                <span className="mt-0.5 text-[10px] tracking-wider text-white/35 uppercase">
                  {months === 1 ? "monthly" : `${months} months`}
                </span>
              </>
            ) : (
              <Link
                href="/admin/settings"
                className="rounded-full px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/20 transition hover:bg-white/10 hover:text-white"
              >
                Set a target
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Telemetry strip */}
      <dl className="relative z-[2] mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 md:grid-cols-4">
        <Telemetry label="MRR" value={usd.format(k.money.mrr)} hint="active retainers" />
        <Telemetry
          label="Next 30 days"
          value={usd.format(k.money.expectedNext30)}
          hint="due soon + MRR"
        />
        <Telemetry label="Outstanding" value={usd.format(k.outstanding)} hint="all unpaid" />
        <Telemetry
          label="Overdue"
          value={usd.format(overdue)}
          hint={overdue > 0 ? "past due date" : "nothing late"}
          tone={overdue > 0 ? "bad" : "good"}
        />
      </dl>
    </section>
  );
}

function Telemetry({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/45 uppercase">
        {tone && (
          <span
            className={cn(
              "size-1.5 rounded-full",
              tone === "bad" ? "bg-red-400 shadow-[0_0_8px] shadow-red-400" : "bg-emerald-400",
            )}
          />
        )}
        {label}
      </dt>
      <dd className="num mt-1 truncate text-xl font-semibold">{value}</dd>
      <dd className="text-[11px] text-white/40">{hint}</dd>
    </div>
  );
}

/* ================================================================== */
/* Triage — the action queue, ranked by severity                       */
/* ================================================================== */

type Severity = "urgent" | "today" | "queue";

const KIND: Record<
  TodayItem["kind"],
  { icon: React.ComponentType<{ className?: string }>; severity: Severity }
> = {
  message: { icon: MessagesSquare, severity: "urgent" },
  invoice: { icon: Receipt, severity: "urgent" },
  meeting: { icon: CalendarDays, severity: "today" },
  changes: { icon: RotateCcw, severity: "today" },
  request: { icon: Inbox, severity: "today" },
  proposal: { icon: FileSignature, severity: "queue" },
  retainer: { icon: Repeat, severity: "queue" },
  approval: { icon: Hourglass, severity: "queue" },
  lead: { icon: Target, severity: "queue" },
};

const SEVERITY: Record<Severity, { label: string; rail: string; chip: string; icon: string }> = {
  urgent: {
    label: "Urgent",
    rail: "bg-red-500",
    chip: "bg-red-500/10 text-red-600 dark:text-red-300",
    icon: "bg-red-500/10 text-red-600 dark:text-red-300",
  },
  today: {
    label: "Today",
    rail: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  queue: {
    label: "Queue",
    rail: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    icon: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

export async function TriagePanel() {
  const items = await getTodayItems();
  const counts = { urgent: 0, today: 0, queue: 0 };
  for (const item of items) counts[KIND[item.kind].severity]++;

  return (
    <section
      aria-label="Needs you"
      className="surface rise relative min-h-[22rem] [--i:2] lg:col-span-4 lg:min-h-0"
    >
      {/* Absolutely filled on desktop so the deck, not this list, sets the row height. */}
      <div className="flex h-full flex-col lg:absolute lg:inset-0">
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Triage</p>
            {items.length > 0 && (
              <span className="signal size-1.5 text-red-500" aria-hidden />
            )}
          </div>
          <h2 className="mt-1.5 font-heading text-xl font-semibold">
            {items.length === 0
              ? "All clear"
              : `${items.length} thing${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} you`}
          </h2>
          {items.length > 0 && (
            <div className="mt-3 flex gap-1.5">
              {(Object.keys(counts) as Severity[])
                .filter((s) => counts[s] > 0)
                .map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      SEVERITY[s].chip,
                    )}
                  >
                    {counts[s]} {SEVERITY[s].label}
                  </span>
                ))}
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <CheckCheck className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">
              Nothing is waiting on you. Go build something.
            </p>
          </div>
        ) : (
          <ul className="mt-3 max-h-[26rem] min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-3 lg:max-h-none [mask-image:linear-gradient(to_bottom,#000_calc(100%-2rem),transparent)]">
            {items.map((item, i) => {
              const meta = KIND[item.kind];
              const sev = SEVERITY[meta.severity];
              const Icon = meta.icon;
              return (
                <li key={i}>
                  <Link
                    href={item.link}
                    className="group relative flex items-center gap-3 rounded-xl py-2 pr-2 pl-3 transition-colors hover:bg-muted/70"
                  >
                    <span className={cn("absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full", sev.rail)} />
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        sev.icon,
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/0 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ================================================================== */
/* Pulse — four tiles, each a door into its page                       */
/* ================================================================== */

export async function PulseRow({ range }: { range: DashboardRange }) {
  const [k, health, pipeline] = await Promise.all([
    getDashboardKpis(range),
    getBusinessHealth(),
    getPipelineSummary(),
  ]);
  const late = health.flags.filter((f) => f.kind === "late").length;
  const hoursDelta = k.hoursThisWeek - k.hoursLastWeek;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <PulseTile
        i={3}
        href="/admin/projects"
        icon={FolderKanban}
        label="Active projects"
        value={String(k.activeProjects)}
        sub={
          late > 0 ? (
            <span className="font-medium text-red-600 dark:text-red-300">{late} past due</span>
          ) : (
            "all on schedule"
          )
        }
      />
      <PulseTile
        i={4}
        href="/admin/reports"
        icon={Clock}
        label={`Hours · ${rangeLabels[range].toLowerCase()}`}
        value={fmtHours(k.hoursInRange)}
        sensitive
        sub={
          k.hoursLastWeek > 0 || k.hoursThisWeek > 0 ? (
            <span className="inline-flex items-center gap-1">
              {fmtHours(k.hoursThisWeek)} this week
              {k.hoursLastWeek > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    hoursDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-300"
                      : "text-amber-600 dark:text-amber-300",
                  )}
                >
                  {hoursDelta >= 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {fmtHours(Math.abs(hoursDelta))}
                </span>
              )}
            </span>
          ) : (
            "nothing logged this week"
          )
        }
      />
      <PulseTile
        i={5}
        href="/admin/leads"
        icon={Target}
        label="Open leads"
        value={String(pipeline.open)}
        sub={
          pipeline.overdue > 0 ? (
            <span className="font-medium text-amber-600 dark:text-amber-300">
              {pipeline.overdue} follow-up{pipeline.overdue === 1 ? "" : "s"} overdue
            </span>
          ) : (
            "follow-ups on track"
          )
        }
      />
      <PulseTile
        i={6}
        href="/admin/task-requests"
        icon={Inbox}
        label="Task requests"
        value={String(k.pendingRequests)}
        sub={k.pendingRequests > 0 ? "awaiting your review" : "inbox clear"}
      />
    </div>
  );
}

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function PulseTile({
  i,
  href,
  icon: Icon,
  label,
  value,
  sub,
  sensitive,
}: {
  i: number;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: React.ReactNode;
  sensitive?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{ "--i": i } as React.CSSProperties}
      className={cn("surface surface-link rise group p-4 sm:p-5", sensitive && "range-sensitive")}
    >
      <div className="flex items-start justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-foreground/70 ring-1 ring-[var(--hairline)] transition-colors group-hover:bg-brand-tint group-hover:text-primary">
          <Icon className="size-[18px]" />
        </span>
        <span className="flex size-7 items-center justify-center rounded-full ring-1 ring-[var(--hairline)] transition group-hover:rotate-45 group-hover:bg-primary group-hover:text-primary-foreground group-hover:ring-primary">
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>
      <p className="num mt-4 text-3xl font-bold">{value}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{label}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </Link>
  );
}

/* ================================================================== */
/* 02 — Money                                                          */
/* ================================================================== */

export async function MoneyGrid({ range }: { range: DashboardRange }) {
  const [k, health] = await Promise.all([getDashboardKpis(range), getBusinessHealth()]);
  const { current, thirty, sixtyPlus } = k.money.aging;
  const overdue = current.amount + thirty.amount + sixtyPlus.amount;
  const buckets = [
    { label: "1–30 days", ...current, color: "bg-amber-400", text: "text-amber-600 dark:text-amber-300" },
    { label: "31–60 days", ...thirty, color: "bg-orange-500", text: "text-orange-600 dark:text-orange-300" },
    { label: "60+ days", ...sixtyPlus, color: "bg-red-500", text: "text-red-600 dark:text-red-300" },
  ];
  const topMax = Math.max(1, ...health.topClients.map((c) => c.collected));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
      {/* Receivables aging */}
      <div className="surface rise p-5 xl:col-span-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Receivables aging</p>
          <Link href="/admin/invoices" className="text-xs font-medium text-primary hover:underline">
            Invoices
          </Link>
        </div>
        <p className="num mt-2 text-3xl font-bold">{usd.format(overdue)}</p>
        <p className="text-xs text-muted-foreground">overdue across every client</p>

        <div className="mt-5 flex h-3 gap-1 overflow-hidden rounded-full">
          {overdue === 0 ? (
            <span className="hatch h-full w-full rounded-full text-emerald-500/40" />
          ) : (
            buckets
              .filter((b) => b.amount > 0)
              .map((b) => (
                <span
                  key={b.label}
                  className={cn("h-full rounded-full", b.color)}
                  style={{ width: `${(b.amount / overdue) * 100}%` }}
                  title={`${b.label}: ${usd.format(b.amount)}`}
                />
              ))
          )}
        </div>

        <dl className="mt-5 space-y-2.5">
          {buckets.map((b) => (
            <div key={b.label} className="flex items-center gap-3 text-sm">
              <span className={cn("size-2 rounded-full", b.color)} />
              <dt className="flex-1 text-muted-foreground">{b.label}</dt>
              <dd className="text-xs text-muted-foreground tabular-nums">
                {b.count} inv.
              </dd>
              <dd
                className={cn(
                  "w-24 text-right font-semibold tabular-nums",
                  b.amount > 0 ? b.text : "text-muted-foreground",
                )}
              >
                {usd.format(b.amount)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Top clients leaderboard */}
      <div className="surface rise p-5 [--i:1] xl:col-span-4">
        <p className="eyebrow">Top clients · lifetime</p>
        {health.topClients.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No paid invoices yet.</p>
        ) : (
          <ol className="mt-4 space-y-3.5">
            {health.topClients.map((c, i) => (
              <li key={c.id}>
                <Link href={`/admin/clients/${c.id}`} className="group flex items-center gap-3">
                  <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-foreground/90 to-foreground/60 text-xs font-semibold text-background">
                    {initials(c.name)}
                    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-card text-[9px] font-bold text-muted-foreground ring-1 ring-[var(--hairline)]">
                      {i + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-primary">
                        {c.name}
                      </span>
                      <span className="num shrink-0 text-sm font-semibold">
                        {usd.format(c.collected)}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-[color-mix(in_oklab,var(--brand)_45%,transparent)] to-[var(--brand)]"
                          style={{ width: `${(c.collected / topMax) * 100}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                        {c.lastContactDays === null
                          ? "no messages"
                          : c.lastContactDays === 0
                            ? "spoke today"
                            : `${c.lastContactDays}d quiet`}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Invoice mix */}
      <div className="surface rise p-5 [--i:2] lg:col-span-2 xl:col-span-3">
        <p className="eyebrow">Invoice mix</p>
        <div className="mt-4">
          <StatusRing data={k.invoicesByStatus} />
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 03 — Delivery                                                       */
/* ================================================================== */

export async function DeliveryGrid() {
  const [lists, health] = await Promise.all([getDashboardLists(), getBusinessHealth()]);

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
      <div className="surface rise overflow-hidden xl:col-span-8">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="eyebrow">Recent projects</p>
          <Link href="/admin/projects" className="text-xs font-medium text-primary hover:underline">
            All projects
          </Link>
        </div>
        {lists.recentProjects.length === 0 ? (
          <p className="px-5 pb-10 pt-6 text-center text-sm text-muted-foreground">
            No projects yet — create your first one from the Projects page.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {lists.recentProjects.map((p) => {
              const pct =
                p.milestonesTotal > 0 ? Math.round((p.milestonesDone / p.milestonesTotal) * 100) : 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`/admin/projects/${p.id}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_6.5rem]"
                  >
                    {/* Explicit placement: a lone row-start on the badge made
                        auto-placement swap it with the title on phones. */}
                    <span className="col-start-1 row-start-1 min-w-0">
                      <span className="block truncate text-sm font-medium group-hover:text-primary">
                        {p.projectName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {projectTypeLabels[p.type]}
                      </span>
                    </span>
                    <span className="hidden truncate text-sm text-muted-foreground sm:col-start-2 sm:row-start-1 sm:block">
                      {p.clientName ?? "—"}
                    </span>
                    <span className="col-span-2 row-start-2 flex items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            pct === 100 ? "bg-success" : "bg-foreground/70",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">
                        {pct}%
                      </span>
                    </span>
                    <span className="col-start-2 row-start-1 justify-self-end sm:col-start-4">
                      <ProjectStatusBadge status={p.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="surface rise p-5 [--i:1] xl:col-span-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Needs attention</p>
          {health.flags.length > 0 && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-300">
              {health.flags.length}
            </span>
          )}
        </div>
        {health.flags.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCheck className="size-5 text-emerald-500" />
            <p className="text-sm text-muted-foreground">Every live project is on track.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-1">
            {health.flags.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/admin/projects/${f.id}`}
                  className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/70"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      f.kind === "late"
                        ? "bg-red-500/10 text-red-600 dark:text-red-300"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {f.kind === "late" ? (
                      <TriangleAlert className="size-4" />
                    ) : (
                      <Hourglass className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.clientName ? `${f.clientName} · ` : ""}
                      {f.reason}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 04 — Flow: what falls due, what just happened                       */
/* ================================================================== */

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" });

export async function FlowGrid() {
  const [lists, activity] = await Promise.all([getDashboardLists(), listActivity({ take: 8 })]);
  const now = serverNow();

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
      <div className="surface rise p-5 xl:col-span-5">
        <p className="eyebrow">Falling due · next 7 days</p>
        {lists.upcomingInvoices.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing due in the next 7 days.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {lists.upcomingInvoices.map((inv) => {
              const due = new Date(inv.dueDate);
              const overdue = due.getTime() < now;
              return (
                <li key={inv.id}>
                  <Link
                    href={`/admin/invoices/${inv.id}`}
                    className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/70"
                  >
                    {/* Calendar tile */}
                    <span
                      className={cn(
                        "flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-lg ring-1",
                        overdue
                          ? "ring-red-500/30"
                          : "ring-[var(--hairline)]",
                      )}
                    >
                      <span
                        className={cn(
                          "w-full py-0.5 text-center text-[9px] font-bold tracking-wider uppercase",
                          overdue ? "bg-red-500 text-white" : "bg-foreground text-background",
                        )}
                      >
                        {monthShort.format(due)}
                      </span>
                      <span className="num py-0.5 text-base font-bold">{due.getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:text-primary">
                        {inv.invoiceNumber}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {inv.clientName}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="num block text-sm font-semibold">
                        {formatCurrency(inv.amount, inv.currency)}
                      </span>
                      <span
                        className={cn(
                          "block text-[11px]",
                          overdue
                            ? "font-semibold text-red-600 dark:text-red-300"
                            : "text-muted-foreground",
                        )}
                      >
                        {overdue
                          ? `${Math.floor((now - due.getTime()) / 86_400_000)}d overdue`
                          : formatDistanceToNow(due, { addSuffix: true })}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="surface rise p-5 [--i:1] xl:col-span-7">
        <p className="eyebrow">Live activity</p>
        {activity.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative mt-4 space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-gradient-to-b before:from-[var(--hairline)] before:via-[var(--hairline)] before:to-transparent">
            {activity.map((e) => {
              const meta = ACTIVITY_META[e.type] ?? { icon: ActivityIcon, tone: "text-muted-foreground" };
              const Icon = meta.icon;
              const body = (
                <>
                  <span className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-[var(--hairline)]">
                    <Icon className={cn("size-3.5", meta.tone)} />
                  </span>
                  <span className="min-w-0 flex-1 pt-1">
                    <span className="block text-sm leading-snug">{e.summary}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={e.id}>
                  {e.link ? (
                    <Link href={e.link} className="flex gap-3 transition-opacity hover:opacity-75">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Notices + skeletons                                                 */
/* ================================================================== */

export async function MissingUsdNotice({ range }: { range: DashboardRange }) {
  const k = await getDashboardKpis(range);
  const n = k.invoicesMissingUsd;
  if (n === 0) return null;
  return (
    <div className="rise mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-200">
      <TriangleAlert className="size-4 shrink-0" />
      <span>
        <strong>{n}</strong> {n === 1 ? "invoice is" : "invoices are"} billed in another
        currency with no USD value set, so {n === 1 ? "it is" : "they are"} not counted in the
        figures below.
      </span>
      <Link href="/admin/invoices" className="font-medium underline underline-offset-2">
        Set {n === 1 ? "it" : "them"}
      </Link>
    </div>
  );
}

export function DeckSkeleton() {
  return (
    <div className="deck min-h-[26rem] p-8 lg:col-span-8">
      <div className="relative z-[2] animate-pulse space-y-4">
        <div className="h-3 w-40 rounded bg-white/10" />
        <div className="h-14 w-72 rounded-lg bg-white/10" />
        <div className="h-3 w-56 rounded bg-white/10" />
        <div className="mt-10 h-24 rounded-xl bg-white/5" />
      </div>
    </div>
  );
}

export function PanelSkeleton({ className, rows = 5 }: { className?: string; rows?: number }) {
  return (
    <div className={cn("surface space-y-3 p-5", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 pt-1">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TilesSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="surface space-y-3 p-5">
          <Skeleton className="size-9 rounded-xl" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ cols = "xl:grid-cols-3", cards = 3 }: { cols?: string; cards?: number }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", cols)}>
      {Array.from({ length: cards }).map((_, i) => (
        <PanelSkeleton key={i} rows={4} />
      ))}
    </div>
  );
}
