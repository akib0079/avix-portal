import Link from "next/link";
import type { BusinessHealth } from "@/lib/dal/dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { usd } from "@/lib/format";
import {
  Target,
  Banknote,
  TriangleAlert,
  Users,
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

/** Tiny inline bar sparkline — no chart library, no client JS. */
function Sparkline({ points }: { points: { label: string; amount: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  return (
    <div className="mt-3 flex items-end gap-1.5">
      {points.map((p, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/80"
            style={{ height: `${Math.max(3, (p.amount / max) * 56)}px` }}
            title={`${p.label}: ${usd.format(p.amount)}`}
          />
          <span className="text-[10px] text-muted-foreground">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

export function BusinessHealthPanel({ health }: { health: BusinessHealth }) {
  const pct =
    health.target > 0
      ? Math.min(100, Math.round((health.collectedThisMonth / health.target) * 100))
      : null;
  const hoursDelta = health.hoursThisWeek - health.hoursLastWeek;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Target vs collected */}
      <Card>
        <CardContent className="pt-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Target className="size-3.5" /> Monthly target
          </p>
          {health.target > 0 ? (
            <>
              <p className="mt-1 font-heading text-2xl font-bold">
                {usd.format(health.collectedThisMonth)}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {usd.format(health.target)}
                </span>
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#fb7a3c] to-[#f65d0b]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {pct}% collected this month
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-heading text-2xl font-bold">
                {usd.format(health.collectedThisMonth)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                collected this month ·{" "}
                <Link href="/admin/settings" className="text-primary hover:underline">
                  set a target
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Collected vs invoiced + hours */}
      <Card>
        <CardContent className="pt-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Banknote className="size-3.5" /> Cash vs invoiced
          </p>
          <p className="mt-1 font-heading text-2xl font-bold">
            {usd.format(health.collectedThisMonth)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            of {usd.format(health.invoicedThisMonth)} invoiced this month
          </p>
          <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {health.hoursThisWeek.toFixed(1)}h this week
            {health.hoursLastWeek > 0 && (
              <span
                className={
                  hoursDelta >= 0
                    ? "flex items-center gap-0.5 font-medium text-emerald-600 dark:text-emerald-300"
                    : "flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-300"
                }
              >
                {hoursDelta >= 0 ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {Math.abs(hoursDelta).toFixed(1)}h vs last
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      {/* 6-month paid trend */}
      <Card>
        <CardContent className="pt-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUp className="size-3.5" /> Collected, last 6 months
          </p>
          <Sparkline points={health.trend} />
        </CardContent>
      </Card>

      {/* Project health flags */}
      <Card className="lg:col-span-2">
        <CardContent className="pt-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TriangleAlert className="size-3.5" /> Needs attention
          </p>
          {health.flags.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Every live project is on track.
            </p>
          ) : (
            <ul className="mt-3 divide-y">
              {health.flags.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/admin/projects/${f.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {f.clientName ? `${f.clientName} · ` : ""}
                        {f.reason}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Top clients */}
      <Card>
        <CardContent className="pt-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Users className="size-3.5" /> Top clients
          </p>
          {health.topClients.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No clients yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {health.topClients.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/clients/${c.id}`}
                    className="min-w-0 truncate text-sm font-medium hover:text-primary"
                  >
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium">
                      {usd.format(c.collected)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {c.lastContactDays === null
                        ? "no messages"
                        : c.lastContactDays === 0
                          ? "spoke today"
                          : `${c.lastContactDays}d since contact`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
