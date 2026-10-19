import Link from "next/link";
import type { CSSProperties } from "react";
import type { LeadStage } from "@prisma/client";
import type { ReportsData } from "@/lib/dal/reports";
import { PageHeader } from "@/components/page-header";
import { RevenueBarChart, SourceDonut } from "@/components/charts-lazy";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { PersonAvatar } from "@/components/board/board-bits";
import { LanePill } from "@/components/ui/status-pill";
import { StatTile } from "@/components/ui/stat-tile";
import { leadStageLabels } from "@/lib/validation/lead";
import { HUE, leadStageColor } from "@/lib/status-colors";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toneChip } from "@/lib/tone";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Clock,
  Receipt,
  Repeat,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

/*
 * The Reports page body. Data in, markup out — the page loads and guards,
 * this renders, so the layout can be previewed with sample numbers.
 */

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** A panel's header: the small-caps label, and an optional link out. */
function PanelHead({
  label,
  href,
  linkLabel,
}: {
  label: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="eyebrow">{label}</p>
      {href && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        >
          {linkLabel} <ArrowUpRight className="size-3" />
        </Link>
      )}
    </div>
  );
}

export function ReportsView({ data }: { data: ReportsData }) {
  const { kpis, timeEarnings, pipeline, monthlyRecurring, utilisation, byCurrency } = data;
  const pipelineWeighted = pipeline.reduce((sum, p) => sum + p.weighted, 0);
  const pipelineValue = pipeline.reduce((sum, p) => sum + p.value, 0);
  const maxUtilisation = Math.max(1, ...utilisation.map((u) => u.hours));
  const underBilled = timeEarnings.earnedFromHours - timeEarnings.totalInvoiced;
  const topMax = Math.max(1, ...data.topClients.map((c) => c.paid + c.outstanding));

  // Stages in the order a lead travels, whatever order they arrived in.
  const STAGE_ORDER: LeadStage[] = ["NEW", "CONTACTED", "PROPOSAL"];
  const stages = STAGE_ORDER.map((stage) => {
    const row = pipeline.find((p) => p.stage === stage);
    return { stage, count: row?.count ?? 0, value: row?.value ?? 0, weighted: row?.weighted ?? 0 };
  });

  return (
    <div>
      <PageHeader title="Reports" description="Where the money and the hours are going." />

      {kpis.missingUsd > 0 && (
        <div className={cn("mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm", toneChip.warn)}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>{kpis.missingUsd}</strong>{" "}
            {kpis.missingUsd === 1 ? "invoice has" : "invoices have"} no USD value yet and{" "}
            {kpis.missingUsd === 1 ? "isn't" : "aren't"} counted here.{" "}
            <Link href="/admin/invoices" className="font-medium whitespace-nowrap underline underline-offset-2">
              Set them
            </Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          i={0}
          icon={TrendingUp}
          label="Revenue this month"
          value={usd.format(kpis.revenueThisMonth)}
          color={HUE.brand}
        />
        <StatTile
          i={1}
          icon={Receipt}
          label="Outstanding"
          value={usd.format(kpis.outstanding)}
          color={HUE.amber}
        />
        <StatTile
          i={2}
          icon={BadgeDollarSign}
          label="Avg paid invoice"
          value={usd.format(kpis.avgInvoice)}
          color={HUE.green}
        />
        <StatTile
          i={3}
          icon={Clock}
          label="Hours this month"
          value={fmtHours(kpis.hoursThisMonth)}
          color={HUE.blue}
        />
      </div>

      <CollapsibleSection id="reports-revenue" index="01" title="Revenue">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="surface p-4 sm:p-5 lg:col-span-2">
            <PanelHead label="Last 12 months" href="/admin/invoices" linkLabel="Invoices" />
            <div className="mt-3 -mx-2 sm:mx-0">
              <RevenueBarChart data={data.monthly} />
            </div>
          </div>
          <div className="surface p-4 sm:p-5">
            <PanelHead label="Paid revenue by source" />
            <div className="mt-3">
              <SourceDonut data={data.bySource} />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="reports-forward" index="02" title="Forward view">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {/* Pipeline as the leads board shows it: a lane per open stage. */}
          <div className="surface p-4 sm:p-5 xl:col-span-3">
            <PanelHead label="Pipeline" href="/admin/leads" linkLabel="Open leads" />
            {pipelineValue === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No open leads — the pipeline is empty.
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-3xl font-bold">{usd.format(pipelineWeighted)}</span>
                  <span className="text-sm text-muted-foreground">
                    weighted · {usd.format(pipelineValue)} total
                  </span>
                </div>

                {/* Where the value sits, as one bar. */}
                <div className="mt-4 flex h-2.5 gap-1 overflow-hidden rounded-full">
                  {stages
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <span
                        key={s.stage}
                        className="h-full rounded-full"
                        style={{
                          width: `${(s.value / pipelineValue) * 100}%`,
                          background: leadStageColor[s.stage],
                        }}
                        title={`${leadStageLabels[s.stage]}: ${usd.format(s.value)}`}
                      />
                    ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {stages.map((s) => {
                    const odds = s.value > 0 ? Math.round((s.weighted / s.value) * 100) : null;
                    return (
                      <Link
                        key={s.stage}
                        href="/admin/leads"
                        style={{ "--col": leadStageColor[s.stage] } as CSSProperties}
                        className="group rounded-2xl border bg-[color-mix(in_oklab,var(--col)_5%,var(--muted))] p-3 transition-[border-color,box-shadow] hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-12px_rgb(15_23_42/0.25)]"
                      >
                        <div className="flex items-center gap-2">
                          <LanePill color={leadStageColor[s.stage]}>
                            {leadStageLabels[s.stage]}
                          </LanePill>
                          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                            {s.count}
                          </span>
                        </div>
                        <p className="num mt-3 text-xl font-bold">{usdWhole.format(s.weighted)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          of {usdWhole.format(s.value)}
                          {odds !== null && ` · ${odds}% odds`}
                        </p>
                      </Link>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Weighted by stage: new 10%, contacted 30%, proposal 60%.
                </p>
              </>
            )}
          </div>

          <div className="surface p-4 sm:p-5 xl:col-span-2">
            <PanelHead label="Committed & capacity" href="/admin/retainers" linkLabel="Retainers" />
            <div className="mt-3 flex items-center gap-3 rounded-2xl border bg-[color-mix(in_oklab,var(--brand)_5%,var(--muted))] p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                <Repeat className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="num text-xl font-bold">
                  {usd.format(monthlyRecurring)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ month</span>
                </p>
                <p className="text-xs text-muted-foreground">recurring from active retainers</p>
              </div>
            </div>

            <p className="eyebrow mt-5 mb-2.5">Hours per person · last 4 weeks</p>
            {utilisation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No attributed time yet — entries logged before attribution existed aren&apos;t
                counted.
              </p>
            ) : (
              <ul className="space-y-3">
                {utilisation.map((person) => (
                  <li key={person.userId} className="flex items-center gap-2.5">
                    <PersonAvatar
                      person={{ id: person.userId, name: person.name, role: "ADMIN" }}
                      size={26}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{person.name}</span>
                        <span className="num shrink-0 font-semibold">{fmtHours(person.hours)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(person.hours / maxUtilisation) * 100}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="reports-clients" index="03" title="Clients & time">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {/* Leaderboard rather than a table: it reads on a phone, and the bar
              shows how much of each client's value is still owed. */}
          <div className="surface p-4 sm:p-5 xl:col-span-3">
            <PanelHead label="Top clients · lifetime" href="/admin/clients" linkLabel="Clients" />
            {data.topClients.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No billed clients yet.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {data.topClients.map((client, i) => (
                  <li key={client.id}>
                    <Link
                      href={`/admin/clients/${client.id}`}
                      className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "num flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                          i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-semibold">
                            {client.name}
                            {client.company && (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                · {client.company}
                              </span>
                            )}
                          </span>
                          <span className="num shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            {usdWhole.format(client.paid)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className="h-full bg-emerald-500"
                            style={{ width: `${(client.paid / topMax) * 100}%` }}
                          />
                          <span
                            className="h-full bg-amber-400"
                            style={{ width: `${(client.outstanding / topMax) * 100}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          {client.projects} project{client.projects === 1 ? "" : "s"}
                          {client.outstanding > 0 && (
                            <span className="text-amber-700 dark:text-amber-300">
                              {" "}
                              · {usdWhole.format(client.outstanding)} outstanding
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="surface p-4 sm:p-5 xl:col-span-2">
            <PanelHead label="Time & earnings" />
            <dl className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                { label: "Hours logged", value: fmtHours(timeEarnings.totalHours), sub: "all time" },
                {
                  label: "Earned from hours",
                  value: usdWhole.format(timeEarnings.earnedFromHours),
                  sub: "hourly work",
                },
                {
                  label: "Invoiced",
                  value: usdWhole.format(timeEarnings.totalInvoiced),
                  sub: "all time",
                },
                {
                  label: "Collected",
                  value: usdWhole.format(timeEarnings.totalPaid),
                  sub: "paid",
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border bg-muted/40 p-3">
                  <dt className="text-[11px] font-medium text-muted-foreground">{stat.label}</dt>
                  <dd className="num mt-1 truncate text-lg font-bold">{stat.value}</dd>
                  <dd className="text-[11px] text-muted-foreground">{stat.sub}</dd>
                </div>
              ))}
            </dl>
            {underBilled > 0 && (
              <p className={cn("mt-3 rounded-xl p-3 text-xs", toneChip.warn)}>
                Hourly work worth <strong>{usd.format(underBilled)}</strong>{" "}
                hasn&apos;t been invoiced yet.
              </p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {byCurrency.length > 1 && (
        <CollapsibleSection id="reports-currency" index="04" title="By currency">
          <div className="surface p-4 sm:p-5">
            <p className="mb-3 text-xs text-muted-foreground">
              The totals above are in USD at each invoice&apos;s recorded value; these are in each
              invoice&apos;s own currency.
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {byCurrency.map((row) => (
                <div key={row.currency} className="rounded-2xl border bg-muted/40 p-3">
                  <LanePill color={HUE.slate}>{row.currency}</LanePill>
                  <dl className="mt-3 space-y-1 text-sm tabular-nums">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Invoiced</dt>
                      <dd className="font-medium">{row.invoiced.toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Collected</dt>
                      <dd className="font-medium text-emerald-600 dark:text-emerald-400">
                        {row.paid.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Outstanding</dt>
                      <dd className="font-medium text-amber-700 dark:text-amber-300">
                        {row.outstanding.toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
