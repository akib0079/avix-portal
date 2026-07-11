import Link from "next/link";
import { getReportsData } from "@/lib/dal/reports";
import { PageHeader } from "@/components/page-header";
import { RevenueBarChart } from "@/components/reports/revenue-bar-chart";
import { SourceDonut } from "@/components/reports/source-donut";
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

export const metadata = { title: "Reports" };

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export default async function ReportsPage() {
  const data = await getReportsData();
  const { kpis, timeEarnings } = data;

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
      accent: "text-amber-600",
    },
    {
      label: "Avg paid invoice",
      value: usd.format(kpis.avgInvoice),
      icon: BadgeDollarSign,
      accent: "text-emerald-600",
    },
    {
      label: "Hours this month",
      value: fmtHours(kpis.hoursThisMonth),
      icon: Clock,
      accent: "text-sky-600",
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
                      <TableCell className="text-sm font-medium text-emerald-600">
                        {usd.format(client.paid)}
                      </TableCell>
                      <TableCell className="text-sm text-amber-600">
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
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
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
