"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { ProposalCard, ProposalEventView } from "@/lib/dal/proposals";
import { formatCurrency } from "@/lib/currency";
import { invoiceStatusLabels, projectTypeLabels } from "@/lib/format";
import { proposalStatusLabels } from "@/lib/validation/proposal";
import { proposalStatusColor } from "@/lib/status-colors";
import { viewSummary } from "@/lib/proposal-rules";
import { SoftPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useProposalDetail } from "./proposal-dialogs";
import { ProposalActionsMenu, type ProposalMenuHandlers } from "./proposal-actions-menu";
import { FolderOpen, Loader2, Pencil, Receipt, Send, UserRound } from "lucide-react";

function formatDay(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMoment(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Opens in a row collapse into one line: twenty reloads are one fact. */
type TimelineRow = { id: string; label: string; detail: string | null; at: string };

function str(meta: Record<string, unknown> | null, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function eventLabel(e: ProposalEventView): { label: string; detail: string | null } {
  switch (e.type) {
    case "SENT":
      return { label: "Sent", detail: null };
    case "RESENT":
      return { label: "Resent with a new link", detail: null };
    case "EXTENDED":
      return {
        label: "Extended",
        detail: str(e.meta, "expiresAt") ? `open until ${formatDay(str(e.meta, "expiresAt"))}` : null,
      };
    case "VIEWED":
      return { label: "Opened by the client", detail: null };
    case "REMINDED":
      return {
        label: "Reminder emailed",
        detail: str(e.meta, "daysBefore") ? `${str(e.meta, "daysBefore")} day(s) before expiry` : null,
      };
    case "SIGNED":
      return {
        label: str(e.meta, "method") === "ADMIN_RECORDED" ? "Marked accepted by you" : "Accepted online",
        detail: str(e.meta, "name") ? `as ${str(e.meta, "name")}` : null,
      };
    case "DECLINED":
      return { label: "Declined", detail: str(e.meta, "reason") ? `“${str(e.meta, "reason")}”` : null };
    case "EXPIRED":
      return { label: "Expired", detail: null };
    case "ARCHIVED":
      return {
        label: "Archived",
        detail: str(e.meta, "removedInvoice") ? `draft invoice ${str(e.meta, "removedInvoice")} removed` : null,
      };
    case "RESTORED":
      return { label: "Restored", detail: null };
    default:
      return { label: String(e.type).toLowerCase(), detail: null };
  }
}

function timeline(events: ProposalEventView[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let run: { count: number; first: string; row: TimelineRow } | null = null;
  // Newest first, so a run's last element is its first open.
  for (const e of events) {
    if (e.type === "VIEWED") {
      if (run) {
        run.count += 1;
        run.first = e.createdAt;
        run.row.label = `Opened by the client ${run.count} times`;
        run.row.detail = `first ${formatMoment(run.first)}`;
        continue;
      }
      const row: TimelineRow = { id: e.id, label: "Opened by the client", detail: null, at: e.createdAt };
      run = { count: 1, first: e.createdAt, row };
      rows.push(row);
      continue;
    }
    run = null;
    const { label, detail } = eventLabel(e);
    rows.push({ id: e.id, label, detail, at: e.createdAt });
  }
  return rows;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-0.5 text-sm [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/**
 * One proposal, opened beside the board: the facts, the scope, the terms, its
 * history and the same actions menu as its card. Loaded on demand, so the
 * board stays a single light query.
 */
export function ProposalDetailSheet({
  card,
  now,
  handlers,
  busy,
  onOpenChange,
}: {
  /** The card this sheet is for; null closes it. */
  card: ProposalCard | null;
  now: number;
  handlers: ProposalMenuHandlers;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { detail, error, loading } = useProposalDetail(card?.id ?? null, card ? JSON.stringify(card) : "");
  const p = card;
  const views = p ? viewSummary(p.viewCount, p.lastViewedAt, now) : null;
  const first = detail?.firstInvoice;

  return (
    <Sheet open={!!card} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Same variant prefix as the primitive's widths, so these replace
        // them: the whole screen on a phone, a wider panel from sm up.
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        style={p ? ({ "--col": proposalStatusColor[p.status] } as CSSProperties) : undefined}
      >
        {p && (
          <>
            <SheetHeader className="border-b pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <SoftPill color={proposalStatusColor[p.status]}>{proposalStatusLabels[p.status]}</SoftPill>
                {p.archivedAt && <SoftPill color="#64748b">Archived {formatDay(p.archivedAt)}</SoftPill>}
              </div>
              <SheetTitle className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{p.title}</SheetTitle>
              <SheetDescription>
                {p.contactName}
                {p.contactCompany ? ` · ${p.contactCompany}` : ""}
                {p.contactEmail ? ` · ${p.contactEmail}` : ""}
              </SheetDescription>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.status === "DRAFT" && !p.archivedAt && (
                  <>
                    <Button size="sm" onClick={() => handlers.send(p)} disabled={busy}>
                      <Send className="size-4" /> Send
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handlers.edit(p)} disabled={busy}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                  </>
                )}
                <ProposalActionsMenu proposal={p} handlers={handlers} busy={busy} className="ml-auto" />
              </div>
            </SheetHeader>

            <div className="space-y-6 p-4">
              <div className="grid grid-cols-2 gap-4">
                <Fact label="Total">
                  <span className="num font-semibold">{formatCurrency(p.total, p.currency)}</span>
                </Fact>
                <Fact label="First invoice">
                  {loading && !detail ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : first?.kind === "invoice" && detail?.invoice ? (
                    <>
                      {formatCurrency(first.amount, first.currency)}
                      <span className="block text-xs text-muted-foreground">
                        {detail.invoice.invoiceNumber} ·{" "}
                        {invoiceStatusLabels[detail.invoice.status].toLowerCase()}
                      </span>
                    </>
                  ) : first?.kind === "deposit" ? (
                    <>
                      {formatCurrency(first.amount, first.currency)}
                      <span className="block text-xs text-muted-foreground">
                        {first.percent}% deposit, created on acceptance
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Fact>
                {p.status === "SENT" && p.expiresAt && (
                  <Fact label="Valid until">{formatDay(p.expiresAt)}</Fact>
                )}
                {p.sentAt && <Fact label="Last sent">{formatDay(p.sentAt)}</Fact>}
                {p.status === "ACCEPTED" && p.acceptedAt && (
                  <Fact label={p.acceptedByAdmin ? "Recorded as agreed" : "Accepted"}>
                    {p.acceptedName} · {formatDay(p.acceptedAt)}
                  </Fact>
                )}
                {(p.status === "SENT" || p.status === "EXPIRED" || p.viewCount > 0) && (
                  <Fact label="Opened">{views ?? <span className="text-muted-foreground">Not yet</span>}</Fact>
                )}
                {detail && <Fact label="Type">{projectTypeLabels[detail.projectType]}</Fact>}
                {detail?.timelineWeeks && (
                  <Fact label="Timeline">
                    {detail.timelineWeeks} week{detail.timelineWeeks === 1 ? "" : "s"}
                  </Fact>
                )}
              </div>

              {p.status === "DECLINED" && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="font-medium">Declined {formatDay(p.declinedAt)}</p>
                  <p className="mt-1 text-muted-foreground">
                    {p.declineReason ? `“${p.declineReason}”` : "No reason given."}
                  </p>
                </div>
              )}

              {(p.convertedProjectId || detail?.invoice || detail?.client) && (
                <div className="flex flex-wrap gap-2">
                  {p.convertedProjectId && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/projects/${p.convertedProjectId}`}>
                        <FolderOpen className="size-4" /> {detail?.projectName ?? "Project"}
                      </Link>
                    </Button>
                  )}
                  {detail?.invoice && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/invoices/${detail.invoice.id}`}>
                        <Receipt className="size-4" /> {detail.invoice.invoiceNumber}
                      </Link>
                    </Button>
                  )}
                  {detail?.client && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/clients/${detail.client.id}`}>
                        <UserRound className="size-4" /> {detail.client.name}
                      </Link>
                    </Button>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {detail && (
                <>
                  {detail.intro && (
                    <section>
                      <h3 className="mb-1.5 text-sm font-semibold">Intro</h3>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{detail.intro}</p>
                    </section>
                  )}

                  <section>
                    <h3 className="mb-1.5 text-sm font-semibold">Scope</h3>
                    <ul className="divide-y rounded-lg border">
                      {detail.items.map((item) => (
                        <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 [overflow-wrap:anywhere]">{item.description}</span>
                          <span className="num shrink-0">{formatCurrency(item.amount, p.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {detail.terms && (
                    <details className="group rounded-lg border">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Terms</summary>
                      <p className="border-t px-3 py-2 text-sm whitespace-pre-wrap text-muted-foreground">
                        {detail.terms}
                      </p>
                    </details>
                  )}

                  <section>
                    <h3 className="mb-1.5 text-sm font-semibold">History</h3>
                    {detail.events.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Created {formatDay(detail.createdAt)}. Nothing has happened yet.
                      </p>
                    ) : (
                      <ol className="space-y-2 border-l pl-4">
                        {timeline(detail.events).map((row) => (
                          <li key={row.id} className="relative text-sm">
                            <span
                              aria-hidden
                              className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-[var(--col)]"
                            />
                            <span className="font-medium">{row.label}</span>
                            {row.detail && <span className="text-muted-foreground"> · {row.detail}</span>}
                            <span className="block text-xs text-muted-foreground">{formatMoment(row.at)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
