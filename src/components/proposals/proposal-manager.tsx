"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ProposalBoard, ProposalCard } from "@/lib/dal/proposals";
import {
  getProposalLink,
  restoreProposal,
  sendProposal,
  setProposalReminders,
} from "@/lib/actions/proposals";
import { ProposalFormDialog, type ProposalLeadOption } from "./proposal-form-dialog";
import { ProposalActionsMenu, type ProposalMenuHandlers } from "./proposal-actions-menu";
import { ProposalDetailSheet } from "./proposal-detail-sheet";
import {
  LeadLostDialog,
  ProposalAcceptDialog,
  ProposalDuplicateDialog,
  ProposalExtendDialog,
  ProposalRemoveDialog,
} from "./proposal-dialogs";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import { formatTotals, viewSummary } from "@/lib/proposal-rules";
import { proposalStatusLabels } from "@/lib/validation/proposal";
import { proposalStatusColor } from "@/lib/status-colors";
import { SoftPill } from "@/components/ui/status-pill";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import type { ProposalStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  BellOff,
  CheckCircle2,
  Eye,
  FileSignature,
  History,
  Paperclip,
  Plus,
} from "lucide-react";

/** Board lanes, in the order a proposal travels. */
const LANES: { status: ProposalStatus; hint: string }[] = [
  { status: "DRAFT", hint: "Not sent yet" },
  { status: "SENT", hint: "Waiting on a reply" },
  { status: "ACCEPTED", hint: "Won — client, project and first invoice created" },
  { status: "DECLINED", hint: "They said no" },
  { status: "EXPIRED", hint: "Lapsed unanswered" },
];

const CLOSED: ProposalStatus[] = ["ACCEPTED", "DECLINED", "EXPIRED"];

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The next, wider window for the closed lanes, as a ?closed= value. */
function widerWindow(closedDays: number | null): { param: string; label: string } | null {
  if (closedDays == null) return null;
  return closedDays < 365
    ? { param: "365", label: "Show the past year" }
    : { param: "all", label: "Show all" };
}

type OpenDialog =
  | { kind: "remove" | "accept" | "duplicate" | "extend" | "lost"; proposal: ProposalCard }
  | null;

/**
 * Keeps ?id= in the address bar in step with the open sheet, without a
 * navigation. Passing null (not history.state) is what lets Next fold the
 * change into its router, so a later revalidation renders the same URL.
 */
function syncOpenParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function ProposalManager({
  board,
  archived,
  linked,
  now,
  leads,
}: {
  board: ProposalBoard;
  /** Showing the archive instead of the live board. */
  archived: boolean;
  /** The card a deep link (?id=) opened, when the board didn't load it. */
  linked: ProposalCard | null;
  now: number;
  leads: ProposalLeadOption[];
}) {
  const [builder, setBuilder] = useState<{ open: boolean; proposalId: string | null }>({
    open: false,
    proposalId: null,
  });
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [detailId, setDetailId] = useState<string | null>(linked?.id ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useLocalChoice("avix.proposals.view", "board", VIEW_MODES);
  // Lost causes only grow; they start folded.
  const [folded, toggleFold] = useLocalSet("avix.proposals.folded", ["DECLINED", "EXPIRED"]);

  const proposals = board.proposals;
  const cards =
    linked && !proposals.some((p) => p.id === linked.id) ? [...proposals, linked] : proposals;
  const detailCard = detailId ? (cards.find((p) => p.id === detailId) ?? null) : null;

  const opened = proposals.filter((p) => p.status === "SENT" && p.viewCount > 0).length;
  const won = formatTotals(board.totals.ACCEPTED);
  const wider = widerWindow(board.closedDays);
  const hiddenIn = (status: ProposalStatus) =>
    CLOSED.includes(status)
      ? Math.max(0, board.counts[status] - proposals.filter((p) => p.status === status).length)
      : 0;
  const anyHidden = CLOSED.some((s) => hiddenIn(s) > 0);
  const nothingAtAll =
    Object.values(board.counts).every((n) => n === 0) && board.archivedCount === 0;

  function openDetail(id: string | null) {
    setDetailId(id);
    syncOpenParam(id);
  }

  /** Runs one card's action with its spinner; the action's revalidation redraws the board. */
  async function run(
    p: ProposalCard,
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    success: string,
  ) {
    setBusyId(p.id);
    const result = await action();
    setBusyId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(success);
  }

  const handlers: ProposalMenuHandlers = {
    edit: (p) => setBuilder({ open: true, proposalId: p.id }),
    send: (p) =>
      run(
        p,
        () => sendProposal(p.id),
        p.status === "DRAFT"
          ? `Proposal sent to ${p.contactEmail}.`
          : `New link sent to ${p.contactEmail}. The old one no longer works.`,
      ),
    copyLink: async (p) => {
      setBusyId(p.id);
      const result = await getProposalLink(p.id);
      setBusyId(null);
      if (!result.ok) return void toast.error(result.error);
      try {
        await navigator.clipboard.writeText(result.data!.url);
        toast.success("Client link copied to clipboard.");
      } catch {
        toast.message("Copy this link", { description: result.data!.url });
      }
    },
    duplicate: (p) => setDialog({ kind: "duplicate", proposal: p }),
    extend: (p) => setDialog({ kind: "extend", proposal: p }),
    markAccepted: (p) => setDialog({ kind: "accept", proposal: p }),
    remove: (p) => setDialog({ kind: "remove", proposal: p }),
    restore: (p) =>
      run(
        p,
        () => restoreProposal(p.id),
        p.status === "SENT"
          ? "Restored. Its old link stays withdrawn — resend or copy a new link for the client."
          : "Restored to the board.",
      ),
    setReminders: (p, enabled) =>
      run(
        p,
        () => setProposalReminders(p.id, enabled),
        enabled ? "Reminder emails resumed." : "Reminder emails paused for this proposal.",
      ),
    markLeadLost: (p) => setDialog({ kind: "lost", proposal: p }),
  };

  /** A card's status line: what is going on with it, in a few words. */
  function statusLine(p: ProposalCard) {
    const views = viewSummary(p.viewCount, p.lastViewedAt, now);
    if (p.archivedAt) return `Archived ${formatDate(p.archivedAt)}`;
    switch (p.status) {
      case "DRAFT":
        return "Not sent yet";
      case "SENT":
        return [p.expiresAt ? `Valid until ${formatDate(p.expiresAt)}` : null, views ?? "Not opened yet"]
          .filter(Boolean)
          .join(" · ");
      case "ACCEPTED":
        return `${p.acceptedByAdmin ? "Recorded as agreed by" : "Signed by"} ${p.acceptedName} · ${formatDate(p.acceptedAt)}`;
      case "DECLINED":
        return `Declined ${formatDate(p.declinedAt) ?? ""}`.trim();
      case "EXPIRED":
        return [`Expired ${formatDate(p.expiresAt) ?? ""}`.trim(), views].filter(Boolean).join(" · ");
    }
  }

  /**
   * One proposal. The same card serves the list and a lane. The title is the
   * button that opens the detail sheet, stretched over the whole card; the
   * menu and links sit above it.
   */
  function renderCard(p: ProposalCard, inLane: boolean) {
    return (
      <div
        key={p.id}
        style={{ "--col": proposalStatusColor[p.status] } as CSSProperties}
        className="relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]"
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              {p.status === "ACCEPTED" ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
              ) : (
                <FileSignature className="size-4 shrink-0 text-[color-mix(in_oklab,var(--col)_75%,var(--foreground))]" />
              )}
              <button
                type="button"
                onClick={() => openDetail(p.id)}
                className="min-w-0 text-left [overflow-wrap:anywhere] outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
              >
                {p.title}
              </button>
              {(!inLane || p.archivedAt) && (
                <SoftPill color={proposalStatusColor[p.status]}>{proposalStatusLabels[p.status]}</SoftPill>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {p.contactName}
              {p.contactCompany ? ` · ${p.contactCompany}` : ""}
              {!p.leadId ? " · manual" : ""}
              {p.attachment && (
                <>
                  {" · "}
                  <a
                    href={`/api/files/proposal-invoice/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="relative z-10 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Paperclip className="size-3" />
                    {p.attachment === "link" ? "invoice link" : "invoice PDF"}
                  </a>
                </>
              )}
            </p>
          </div>
          <ProposalActionsMenu
            proposal={p}
            handlers={handlers}
            busy={busyId === p.id}
            className="relative z-10 -mt-1 -mr-1.5"
          />
        </div>

        <p
          className={
            p.status === "ACCEPTED" && !p.archivedAt
              ? "mt-1.5 text-xs text-emerald-700 dark:text-emerald-300"
              : "mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
          }
        >
          {p.status === "SENT" && p.viewCount > 0 && !p.archivedAt && (
            <Eye className="size-3 shrink-0 text-[color-mix(in_oklab,var(--col)_75%,var(--foreground))]" />
          )}
          {statusLine(p)}
          {p.status === "SENT" && !p.remindersEnabled && !p.archivedAt && (
            <span className="inline-flex items-center gap-1">
              · <BellOff className="size-3" /> reminders off
            </span>
          )}
        </p>
        {p.status === "DECLINED" && p.declineReason && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground italic">“{p.declineReason}”</p>
        )}

        <p className="num mt-2 text-base font-bold text-primary">{formatCurrency(p.total, p.currency)}</p>
      </div>
    );
  }

  const moreLink = wider && (
    <Link
      href={`/admin/proposals?closed=${wider.param}`}
      scroll={false}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      <History className="size-3.5" />
      {wider.label}
    </Link>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {archived ? (
          <p className="text-sm text-muted-foreground">
            {board.archivedCount} archived
            {board.archivedCount > proposals.length ? ` (the latest ${proposals.length} shown)` : ""}.
            Restoring one puts it back in its lane; links sent before it was archived stay withdrawn.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {board.counts.SENT} awaiting a reply
            {opened > 0 ? ` (${opened} opened)` : ""} ·{" "}
            <span className="font-semibold text-foreground">{won || "nothing yet"}</span> won from{" "}
            {board.counts.ACCEPTED} accepted
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={archived ? "/admin/proposals" : "/admin/proposals?archived=1"}>
              {archived ? (
                <>
                  <ArrowLeft className="size-4" /> Back to the board
                </>
              ) : (
                <>
                  <Archive className="size-4" /> Archived
                  {board.archivedCount > 0 ? ` (${board.archivedCount})` : ""}
                </>
              )}
            </Link>
          </Button>
          {!archived && <ViewToggle value={view} onChange={setView} />}
          <Button onClick={() => setBuilder({ open: true, proposalId: null })}>
            <Plus /> New proposal
          </Button>
        </div>
      </div>

      {archived ? (
        proposals.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            Nothing archived.
          </div>
        ) : (
          <div className="space-y-3">{proposals.map((p) => renderCard(p, false))}</div>
        )
      ) : nothingAtAll ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FileSignature className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No proposals yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Build one from a lead, or enter the recipient manually. When they accept online — or
            you mark it accepted — their account, project and first invoice are created for you.
          </p>
        </div>
      ) : view === "board" ? (
        <LaneScroller>
          {LANES.map((lane) => {
            const items = proposals.filter((p) => p.status === lane.status);
            const hidden = hiddenIn(lane.status);
            const meta = formatTotals(board.totals[lane.status]);
            return (
              <Lane
                key={lane.status}
                color={proposalStatusColor[lane.status]}
                title={proposalStatusLabels[lane.status]}
                count={board.counts[lane.status]}
                meta={meta || undefined}
                hint={lane.hint}
                collapsed={folded.has(lane.status)}
                onToggle={() => toggleFold(lane.status)}
                className="lg:min-w-[260px]"
                empty={
                  items.length === 0 ? (
                    <LaneEmpty>{hidden > 0 ? "Nothing recent" : "Nothing here"}</LaneEmpty>
                  ) : undefined
                }
                footer={
                  hidden > 0 && moreLink ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                      <span>{hidden} older</span>
                      {moreLink}
                    </div>
                  ) : undefined
                }
              >
                {items.map((p) => renderCard(p, true))}
              </Lane>
            );
          })}
        </LaneScroller>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => renderCard(p, false))}
          {anyHidden && moreLink && (
            <div className="flex justify-center py-2">{moreLink}</div>
          )}
        </div>
      )}

      <ProposalFormDialog
        proposalId={builder.proposalId}
        leads={leads}
        open={builder.open}
        onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
      />

      <ProposalDetailSheet
        card={detailCard}
        now={now}
        handlers={handlers}
        busy={detailCard != null && busyId === detailCard.id}
        onOpenChange={(open) => !open && openDetail(null)}
      />

      {dialog?.kind === "remove" && (
        <ProposalRemoveDialog
          proposal={dialog.proposal}
          onClose={(removed) => {
            if (removed && detailId === dialog.proposal.id) openDetail(null);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "accept" && (
        <ProposalAcceptDialog proposal={dialog.proposal} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "duplicate" && (
        <ProposalDuplicateDialog
          proposal={dialog.proposal}
          leads={leads}
          onClose={() => setDialog(null)}
          onDuplicated={(id) => {
            setDialog(null);
            setBuilder({ open: true, proposalId: id });
          }}
        />
      )}
      {dialog?.kind === "extend" && (
        <ProposalExtendDialog proposal={dialog.proposal} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "lost" && (
        <LeadLostDialog proposal={dialog.proposal} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
