/**
 * Dashboard time windows. Shared by the server DAL and the client-side range
 * switcher, so it deliberately lives OUTSIDE the server-only dal module.
 */
export const DASHBOARD_RANGES = ["month", "last", "quarter", "ytd"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const rangeLabels: Record<DashboardRange, string> = {
  month: "This month",
  last: "Last month",
  quarter: "Last 3 months",
  ytd: "Year to date",
};

export function parseRange(value?: string): DashboardRange {
  return (DASHBOARD_RANGES as readonly string[]).includes(value ?? "")
    ? (value as DashboardRange)
    : "month";
}

/** Start (inclusive) / end (exclusive) instants for a range. */
export function rangeWindow(range: DashboardRange, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (range) {
    case "last":
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case "quarter":
      return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1) };
    case "ytd":
      return { start: new Date(y, 0, 1), end: new Date(y, m + 1, 1) };
    default:
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  }
}
