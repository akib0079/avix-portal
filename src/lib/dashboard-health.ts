import type { Prisma } from "@prisma/client";

/**
 * Shaping for the dashboard's health reads: the paid trend, the project flags
 * and the top-clients board. Kept out of the server-only DAL so it can be
 * tested; the queries stay in src/lib/dal/dashboard.ts.
 */

type Money = Prisma.Decimal | number | null;
type ClientName = { firstName: string; lastName: string } | null;

export type MonthPoint = { label: string; amount: number };

export type ProjectFlag = {
  id: string;
  name: string;
  clientName: string | null;
  reason: string;
  kind: "late" | "stale";
};

export type TopClient = {
  id: string;
  name: string;
  collected: number;
  lastContactDays: number | null;
};

/** Paid totals (USD) for the six calendar months up to `now`'s, oldest first. */
export function paidTrend(
  rows: { amountUsd: Money; issueDate: Date }[],
  now: Date,
): MonthPoint[] {
  const buckets = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
  }
  for (const inv of rows) {
    const key = `${inv.issueDate.getFullYear()}-${inv.issueDate.getMonth()}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + Number(inv.amountUsd));
  }
  return [...buckets.entries()].map(([key, amount]) => {
    const [y, m] = key.split("-").map(Number);
    return {
      label: new Date(y, m, 1).toLocaleString("en-US", { month: "short" }),
      amount,
    };
  });
}

const fullName = (c: ClientName) => (c ? `${c.firstName} ${c.lastName}`.trim() : null);

/** Late projects first, then stale ones; a project that is both shows once. */
export function projectFlags(
  late: { id: string; projectName: string; dueDate: Date | null; client: ClientName }[],
  stale: { id: string; projectName: string; updatedAt: Date; client: ClientName }[],
  now: Date,
): ProjectFlag[] {
  return [
    ...late.map((p) => ({
      id: p.id,
      name: p.projectName,
      clientName: fullName(p.client),
      reason: `past due ${p.dueDate!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      kind: "late" as const,
    })),
    ...stale.map((p) => ({
      id: p.id,
      name: p.projectName,
      clientName: fullName(p.client),
      reason: `no activity in ${Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000)} days`,
      kind: "stale" as const,
    })),
  ]
    .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i)
    .slice(0, 6);
}

/** Rows of the top-clients query, already ranked by the database. */
export type TopClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  collected: Money;
  lastContact: Date | null;
};

/** Keeps the database's order (collected desc, then id), so ties stay stable. */
export function toTopClients(rows: TopClientRow[], now: Date): TopClient[] {
  return rows.map((c) => ({
    id: c.id,
    name: c.company || `${c.firstName} ${c.lastName}`.trim() || "Client",
    collected: Number(c.collected ?? 0),
    lastContactDays: c.lastContact
      ? Math.floor((now.getTime() - c.lastContact.getTime()) / 86_400_000)
      : null,
  }));
}
