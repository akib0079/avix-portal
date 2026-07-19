"use client";

import dynamic from "next/dynamic";
import type { InvoiceStatus } from "@prisma/client";

/**
 * Recharts is heavy and only appears below the fold on Dashboard and Reports.
 * Loading it eagerly delayed the numbers those pages exist to show, so the
 * charts are fetched on demand behind a fixed-height placeholder (same height
 * as the real chart, so nothing jumps when it arrives).
 */

function ChartPlaceholder({ height }: { height: string }) {
  return (
    <div
      className={`${height} animate-pulse rounded-lg bg-muted/50`}
      aria-busy="true"
      aria-label="Loading chart"
    />
  );
}

export const InvoiceStatusDonut = dynamic<{
  data: { status: InvoiceStatus; count: number }[];
}>(
  () =>
    import("./dashboard/invoice-status-donut").then((m) => m.InvoiceStatusDonut),
  { ssr: false, loading: () => <ChartPlaceholder height="h-56" /> },
);

export const RevenueBarChart = dynamic<{
  data: { month: string; paid: number; unpaid: number }[];
}>(() => import("./reports/revenue-bar-chart").then((m) => m.RevenueBarChart), {
  ssr: false,
  loading: () => <ChartPlaceholder height="h-64" />,
});

export const SourceDonut = dynamic<{
  data: { name: string; value: number }[];
}>(() => import("./reports/source-donut").then((m) => m.SourceDonut), {
  ssr: false,
  loading: () => <ChartPlaceholder height="h-56" />,
});
