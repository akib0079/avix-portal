"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { InvoiceStatus } from "@prisma/client";
import { invoiceStatusLabels } from "@/lib/format";

const statusColors: Record<InvoiceStatus, string> = {
  PAID: "var(--success)",
  SENT: "var(--info)",
  IN_REVIEW: "var(--warning)",
  ASSIGNED: "#94a3b8",
};

export function InvoiceStatusDonut({
  data,
}: {
  data: { status: InvoiceStatus; count: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center text-sm text-muted-foreground">
        No invoices yet.
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: invoiceStatusLabels[d.status],
      value: d.count,
      color: statusColors[d.status],
    }));

  return (
    <div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={3}
              strokeWidth={0}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {chartData.map((entry) => (
          <span
            key={entry.name}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name} ({entry.value})
          </span>
        ))}
      </div>
    </div>
  );
}
