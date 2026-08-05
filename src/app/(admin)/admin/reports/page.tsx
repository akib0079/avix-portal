import Link from "next/link";
import { getReportsData } from "@/lib/dal/reports";
import { PageHeader } from "@/components/page-header";
import { RevenueBarChart, SourceDonut } from "@/components/charts-lazy";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd } from "@/lib/format";
import { BadgeDollarSign, Clock, Receipt, TrendingUp } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";
import { toneText } from "@/lib/tone";

export const metadata = { title: "Reports" };

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export default async function ReportsPage() {
  await requireAdmin();
  const data = await getReportsData();
  const { kpis, timeEarnings, pipeline, monthlyRecurring, utilisation, byCurrency } = data;
  const pipelineWeighted = pipeline.reduce((sum, p) => sum + p.weighted, 0);
  const pipelineValue = pipeline.reduce((sum, p) => sum + p.value, 0);
  const maxUtilisation = Math.max(1, ...utilisation.map((u) => u.hours));

  const kpiCards = [
    {
      label: "Revenue this month",
      value: usd.format(kpis.revenueThisMonth),
      icon: TrendingUp,
      accent: "text-primary",
    },
    {
      label: "Outstanding",
      value: usd.format(kpis.outstanding),
      icon: Receipt,
      accent: toneText.warn,
    },
    {
      label: "Avg paid invoice",
      value: usd.format(kpis.avgInvoice),
      icon: BadgeDollarSign,
      accent: toneText.good,
    },
    {
      label: "Hours this month",
      value: fmtHours(kpis.hoursThisMonth),
      icon: Clock,
      accent: toneText.info,
    },
  ];

  const underBilled = timeEarnings.earnedFromHours - timeEarnings.totalInvoiced;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Where the money and the hours are going."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border bg-card p-5">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <kpi.icon className="size-3.5" /> {kpi.label}
            </p>
            <p className={`font-heading mt-1 text-2xl font-bold ${kpi.accent}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Revenue — last 12 months
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueBarChart data={data.monthly} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Paid revenue by source</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceDonut data={data.bySource} />
          </CardContent>
        </Card>
      </div>

      {/* Forward view — everything above this point is history. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {pipeline.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No open leads — the pipeline is empty.
              </p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-heading text-2xl font-bold">
                    {usd.format(pipelineWeighted)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    weighted · {usd.format(pipelineValue)} total
                  </span>
                </div>
                <ul className="space-y-2">
                  {pipeline.map((row) => (
                    <li key={row.stage} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {row.stage.charAt(0) + row.stage.slice(1).toLowerCase()}
                        <span className="ml-1 text-xs">({row.count})</span>
                      </span>
                      <span className="font-medium">
                        {usd.format(row.weighted)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          of {usd.format(row.value)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Weighted by stage: new 10%, contacted 30%, proposal 60%.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Committed &amp; capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Recurring revenue (active retainers)
              </p>
              <p className="font-heading text-xl font-bold">
                {usd.format(monthlyRecurring)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ month</span>
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Hours logged per person · last 4 weeks
              </p>
              {utilisation.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No attributed time yet — entries logged before attribution
                  existed aren&apos;t counted.
                </p>
              ) : (
                <ul className="space-y-2">
                  {utilisation.map((person) => (
                    <li key={person.userId}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{person.name}</span>
                        <span className="font-medium">{fmtHours(person.hours)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(person.hours / maxUtilisation) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {byCurrency.length > 1 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-heading text-lg">By currency</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              The totals above add every currency together — these don&apos;t.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead>Invoiced</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead>Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCurrency.map((row) => (
                  <TableRow key={row.currency}>
                    <TableCell className="font-medium">{row.currency}</TableCell>
                    <TableCell>{row.invoiced.toFixed(2)}</TableCell>
                    <TableCell>{row.paid.toFixed(2)}</TableCell>
                    <TableCell>{row.outstanding.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Top clients</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topClients.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No billed clients yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="hidden sm:table-cell">Projects</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topClients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <Link
                          href={`/admin/clients/${client.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {client.name}
                        </Link>
                        {client.company && (
                          <p className="text-xs text-muted-foreground">{client.company}</p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {client.projects}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-emerald-600 dark:text-emerald-300">
                        {usd.format(client.paid)}
                      </TableCell>
                      <TableCell className="text-sm text-amber-600 dark:text-amber-300">
                        {client.outstanding > 0 ? usd.format(client.outstanding) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Time &amp; earnings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Hours logged (all time)</p>
              <p className="font-heading text-xl font-bold">
                {fmtHours(timeEarnings.totalHours)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Earned from hourly work</p>
              <p className="font-heading text-xl font-bold">
                {usd.format(timeEarnings.earnedFromHours)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Invoiced / collected</p>
              <p className="font-heading text-xl font-bold">
                {usd.format(timeEarnings.totalInvoiced)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  / {usd.format(timeEarnings.totalPaid)} paid
                </span>
              </p>
            </div>
            {underBilled > 0 && (
              <p className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-700 dark:text-amber-300">
                Hourly work worth {usd.format(underBilled)} hasn&apos;t been
                invoiced yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
