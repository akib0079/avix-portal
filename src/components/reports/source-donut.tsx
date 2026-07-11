"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { usd } from "@/lib/format";

const palette = ["var(--primary)", "#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#94a3b8"];

export function SourceDonut({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No paid invoices yet.
      </div>
    );
  }

  return (
    <div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => usd.format(Number(value))}
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
        {data.map((entry, i) => (
          <span
            key={entry.name}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: palette[i % palette.length] }}
            />
            {entry.name} ({usd.format(entry.value)})
          </span>
        ))}
      </div>
    </div>
  );
}
