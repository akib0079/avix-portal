import type { InvoiceStatus } from "@prisma/client";
import { invoiceStatusLabels } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Dashboard instruments, drawn as plain SVG on the server.
 *
 * The dashboard used to lazy-load Recharts (~100 KB gz) for one donut, behind
 * a placeholder that popped in after hydration. These render in the HTML the
 * server already sends: no chart bundle, no layout shift, nothing to hydrate.
 */

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function compactMoney(n: number) {
  return compactUsd.format(n);
}

/* ------------------------------------------------------------------ */
/* Target dial — a 270° instrument gauge with tick marks.              */
/* ------------------------------------------------------------------ */

const DIAL_TICKS = 40;
const DIAL_SWEEP = 270;

export function TargetDial({
  value,
  target,
  className,
}: {
  value: number;
  target: number;
  className?: string;
}) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const lit = Math.round(pct * DIAL_TICKS);
  // Arc runs from 135° (bottom-left) clockwise to 405° (bottom-right).
  const r = 78;
  const c = 2 * Math.PI * r;
  const arc = (DIAL_SWEEP / 360) * c;

  return (
    <svg viewBox="0 0 200 200" className={cn("overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id="dial-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "color-mix(in oklab, var(--brand) 55%, white)" }} />
          <stop offset="100%" style={{ stopColor: "var(--brand)" }} />
        </linearGradient>
        <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Tick ring */}
      <g transform="translate(100 100)">
        {Array.from({ length: DIAL_TICKS + 1 }).map((_, i) => {
          const angle = 135 + (i / DIAL_TICKS) * DIAL_SWEEP;
          const major = i % 5 === 0;
          return (
            <line
              key={i}
              x1={major ? 90 : 92}
              x2={97}
              transform={`rotate(${angle})`}
              style={{
                stroke: i <= lit && pct > 0 ? "var(--brand)" : "rgb(255 255 255 / 0.18)",
              }}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* Track */}
      <circle
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${c}`}
        transform="rotate(135 100 100)"
      />
      {pct > 0 && (
        <>
          {/* Glow underlay, then the value arc itself */}
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            style={{ stroke: "var(--brand)", strokeOpacity: 0.55 }}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arc * pct} ${c}`}
            transform="rotate(135 100 100)"
            filter="url(#dial-glow)"
          />
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="url(#dial-grad)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arc * pct} ${c}`}
            transform="rotate(135 100 100)"
          />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Trend area — smooth line + gradient fill, current point beaconed.   */
/* ------------------------------------------------------------------ */

/** Catmull-Rom through the points, emitted as cubic Béziers. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function TrendArea({
  points,
  className,
}: {
  points: { label: string; amount: number }[];
  className?: string;
}) {
  const W = 600;
  const H = 120;
  const PAD = 10;
  const max = Math.max(1, ...points.map((p) => p.amount));
  const xy: [number, number][] = points.map((p, i) => [
    (i / Math.max(1, points.length - 1)) * W,
    PAD + (1 - p.amount / max) * (H - PAD * 2),
  ]);
  const line = smoothPath(xy);
  const last = xy[xy.length - 1];

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--brand)", stopOpacity: 0.35 }} />
            <stop offset="100%" style={{ stopColor: "var(--brand)", stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id="trend-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--brand)", stopOpacity: 0.25 }} />
            <stop offset="100%" style={{ stopColor: "var(--brand)" }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="rgb(255 255 255 / 0.07)"
            strokeDasharray="2 6"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#trend-fill)" />
        <path
          d={line}
          fill="none"
          stroke="url(#trend-stroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The beacon is HTML so the stretched viewBox can't squash it. */}
      {last && (
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 text-[var(--brand)]"
          style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}
        >
          <span className="signal absolute inset-0 m-auto size-2.5" />
          <span className="absolute inset-0 rounded-full ring-2 ring-white/80" />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status ring — segmented donut with a gap between segments.          */
/* ------------------------------------------------------------------ */

export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  PAID: "var(--success)",
  PARTIALLY_PAID: "color-mix(in oklab, var(--info) 55%, var(--success))",
  SENT: "var(--info)",
  IN_REVIEW: "var(--warning)",
  ASSIGNED: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
  CANCELLED: "color-mix(in oklab, var(--muted-foreground) 30%, transparent)",
};

const STATUS_ORDER: InvoiceStatus[] = [
  "PAID",
  "PARTIALLY_PAID",
  "SENT",
  "IN_REVIEW",
  "ASSIGNED",
  "CANCELLED",
];

export function StatusRing({
  data,
}: {
  data: { status: InvoiceStatus; count: number }[];
}) {
  const rows = STATUS_ORDER.map((status) => ({
    status,
    count: data.find((d) => d.status === status)?.count ?? 0,
  })).filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (total === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No invoices yet.</p>;
  }

  const gap = rows.length > 1 ? 1.6 : 0;
  // Each segment starts where the previous ones end (cumulative share).
  const starts = rows.map((_, i) =>
    rows.slice(0, i).reduce((sum, r) => sum + (r.count / total) * 100, 0),
  );

  return (
    // Stacks in a narrow card, sits side by side when there is room: the
    // legend's labels are the point, and a fixed row squeezed them to nothing.
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @[20rem]:flex-row">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 42 42" className="size-full -rotate-90" aria-hidden>
            <circle
              cx="21"
              cy="21"
              r="16"
              fill="none"
              strokeWidth="4.5"
              style={{ stroke: "var(--hairline)" }}
            />
            {rows.map((r, i) => {
              const len = (r.count / total) * 100;
              return (
                <circle
                  key={r.status}
                  cx="21"
                  cy="21"
                  r="16"
                  fill="none"
                  pathLength={100}
                  style={{ stroke: INVOICE_STATUS_COLOR[r.status] }}
                  strokeWidth="4.5"
                  strokeDasharray={`${Math.max(0.01, len - gap)} ${100 - len + gap}`}
                  strokeDashoffset={-starts[i]}
                >
                  <title>{`${invoiceStatusLabels[r.status]}: ${r.count}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-2xl font-bold">{total}</span>
            <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
              invoices
            </span>
          </div>
        </div>
        <ul className="grid w-full min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 @[20rem]:grid-cols-1">
          {rows.map((r) => (
            <li key={r.status} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: INVOICE_STATUS_COLOR[r.status] }}
              />
              <span className="flex-1 truncate text-muted-foreground">
                {invoiceStatusLabels[r.status]}
              </span>
              <span className="font-medium tabular-nums">{r.count}</span>
              <span className="hidden w-9 text-right text-muted-foreground tabular-nums @[20rem]:inline">
                {Math.round((r.count / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
