"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";

export function RevenueBarChart({
  data,
}: {
  data: { month: string; paid: number; unpaid: number }[];
}) {
  if (data.every((d) => d.paid === 0 && d.unpaid === 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No invoices in the last 12 months.
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={54}
            tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`)}
          />
          <Tooltip
            formatter={(value) => usd.format(Number(value))}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
            cursor={{ fill: "var(--muted)" }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value: string) => (
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{value}</span>
            )}
          />
          <Bar
            dataKey="paid"
            name="Paid"
            stackId="rev"
            fill="var(--primary)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unpaid"
            name="Billed, unpaid"
            stackId="rev"
            fill="#cbd5e1"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
