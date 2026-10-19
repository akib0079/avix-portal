"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProposalView } from "@/lib/dal/proposals";
import {
  deleteProposal,
  sendProposal,
  getProposalLink,
  markProposalAccepted,
} from "@/lib/actions/proposals";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ProposalFormDialog,
  type ProposalLeadOption,
} from "./proposal-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usd } from "@/lib/format";
import { proposalStatusLabels } from "@/lib/validation/proposal";
import { proposalStatusColor } from "@/lib/status-colors";
import { SoftPill } from "@/components/ui/status-pill";
import { Lane, LaneEmpty, LaneScroller, ViewToggle, VIEW_MODES } from "@/components/ui/lanes";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import type { ProposalStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Send,
  Link2,
  FileSignature,
  CheckCircle2,
  Paperclip,
} from "lucide-react";

/** Board lanes, in the order a proposal travels. */
const LANES: { status: ProposalStatus; hint: string }[] = [
  { status: "DRAFT", hint: "Not sent yet" },
  { status: "SENT", hint: "Waiting on a reply" },
  { status: "ACCEPTED", hint: "Won — client, project and deposit created" },
  { status: "DECLINED", hint: "They said no" },
  { status: "EXPIRED", hint: "Lapsed unanswered" },
];

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProposalManager({
  proposals,
  leads,
  paymentAccounts,
}: {
  proposals: ProposalView[];
  leads: ProposalLeadOption[];
  paymentAccounts: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProposalView | null>(null);
  const [deleting, setDeleting] = useState<ProposalView | null>(null);
  const [accepting, setAccepting] = useState<ProposalView | null>(null);
  const [acceptName, setAcceptName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useLocalChoice("avix.proposals.view", "board", VIEW_MODES);
  // Lost causes only grow; they start folded.
  const [folded, toggleFold] = useLocalSet("avix.proposals.folded", ["DECLINED", "EXPIRED"]);

  const accepted = proposals.filter((p) => p.status === "ACCEPTED");
  const outstanding = proposals.filter((p) => p.status === "SENT");

  async function onSend(proposal: ProposalView) {
    setBusyId(proposal.id);
    const result = await sendProposal(proposal.id);
    setBusyId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Proposal sent to ${proposal.contactEmail}.`);
    router.refresh();
  }

  async function onCopyLink(proposal: ProposalView) {
    setBusyId(proposal.id);
    const result = await getProposalLink(proposal.id);
    setBusyId(null);
    if (!result.ok) return void toast.error(result.error);
    await navigator.clipboard.writeText(result.data!.url);
    toast.success("Public link copied to clipboard.");
  }

  /**
   * One proposal. The same card serves the list and a lane: it lays out side
   * by side when it has the room and stacks when it doesn't, so the lane
   * version is not a second design to keep in step.
   */
  function renderCard(p: ProposalView, inLane: boolean) {
    return (
      <div
        key={p.id}
        style={{ "--col": proposalStatusColor[p.status] } as CSSProperties}
        className="@container relative overflow-hidden rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]"
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
        <div className="flex flex-col gap-3 @[36rem]:flex-row @[36rem]:items-start @[36rem]:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]">
              {p.status === "ACCEPTED" ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
              ) : (
                <FileSignature className="size-4 shrink-0 text-primary" />
              )}
              {p.title}
              {!inLane && (
                <SoftPill color={proposalStatusColor[p.status]}>
                  {proposalStatusLabels[p.status]}
                </SoftPill>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.contactName}
              {p.contactCompany ? ` · ${p.contactCompany}` : ""}
              {!p.leadId ? " · manual" : ""}
              {(p.invoicePdfPath || p.invoicePdfExternalUrl) && (
                <>
                  {" · "}
                  <a
                    href={`/api/files/proposal-invoice/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Paperclip className="size-3" />
                    {p.invoicePdfExternalUrl ? "invoice link" : "invoice PDF"}
                  </a>
                </>
              )}
              {p.status === "SENT" && p.expiresAt ? ` · valid until ${formatDate(p.expiresAt)}` : ""}
              {p.status === "DRAFT" ? " · not sent yet" : ""}
            </p>

            {p.status === "ACCEPTED" && (
              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                {p.acceptedByAdmin ? "Recorded as agreed by " : "Signed by "}
                <strong>{p.acceptedName}</strong> on {formatDate(p.acceptedAt)}
                {p.acceptedByAdmin ? " (marked by you)" : ""}
                {p.convertedProjectId && (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/projects/${p.convertedProjectId}`}
                      className="underline hover:text-emerald-800 dark:text-emerald-300"
                    >
                      View project
                    </Link>
                  </>
                )}
                {p.convertedInvoiceId && (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/invoices/${p.convertedInvoiceId}`}
                      className="underline hover:text-emerald-800 dark:text-emerald-300"
                    >
                      Deposit invoice
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t pt-3 @[36rem]:border-t-0 @[36rem]:pt-0">
            <span className="num mr-auto text-lg font-bold text-primary @[36rem]:mr-0">
              {usd.format(p.total)}
            </span>

            {p.status === "DRAFT" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => onSend(p)}
                >
                  {busyId === p.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    setEditing(p);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="size-4" />
                  <span className="sr-only">Edit</span>
                </Button>
              </>
            )}

            {(p.status === "SENT" || p.status === "DECLINED") && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => onCopyLink(p)}
                >
                  {busyId === p.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                  Copy link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => onSend(p)}
                >
                  Resend
                </Button>
              </>
            )}

            {p.status !== "ACCEPTED" && p.status !== "DECLINED" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-600 dark:text-emerald-300 hover:text-emerald-700 dark:text-emerald-300"
                title="They agreed by call or chat — close it yourself"
                onClick={() => {
                  setAcceptName(p.contactName);
                  setAccepting(p);
                }}
              >
                <CheckCircle2 className="size-4" /> Mark accepted
              </Button>
            )}

            {p.status !== "ACCEPTED" && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => setDeleting(p)}
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Delete</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {outstanding.length} awaiting a reply ·{" "}
          <span className="font-semibold text-foreground">
            {usd.format(accepted.reduce((sum, p) => sum + p.total, 0))}
          </span>{" "}
          won from {accepted.length} accepted
        </p>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> New proposal
          </Button>
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FileSignature className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No proposals yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Build one from a lead, or enter the recipient manually. When they
            accept online — or you mark it accepted — their account, project and
            deposit invoice are created for you.
          </p>
        </div>
      ) : view === "board" ? (
        <LaneScroller>
          {LANES.map((lane) => {
            const items = proposals.filter((p) => p.status === lane.status);
            const total = items.reduce((sum, p) => sum + p.total, 0);
            return (
              <Lane
                key={lane.status}
                color={proposalStatusColor[lane.status]}
                title={proposalStatusLabels[lane.status]}
                count={items.length}
                meta={total > 0 ? usd.format(total) : undefined}
                hint={lane.hint}
                collapsed={folded.has(lane.status)}
                onToggle={() => toggleFold(lane.status)}
                className="lg:min-w-[260px]"
                empty={items.length === 0 ? <LaneEmpty>Nothing here</LaneEmpty> : undefined}
              >
                {items.map((p) => renderCard(p, true))}
              </Lane>
            );
          })}
        </LaneScroller>
      ) : (
        <div className="space-y-3">{proposals.map((p) => renderCard(p, false))}</div>
      )}

      <ProposalFormDialog
        proposal={editing}
        leads={leads}
        paymentAccounts={paymentAccounts}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <Dialog open={!!accepting} onOpenChange={(open) => !open && setAccepting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark “{accepting?.title}” as accepted?</DialogTitle>
            <DialogDescription>
              Use this when they agreed by call, chat or email. This creates their
              client account (with an invite email), the project, and a draft{" "}
              {accepting?.depositPercent}% deposit invoice — same as if they
              accepted online.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="accept-name">Who agreed?</Label>
            <Input
              id="accept-name"
              value={acceptName}
              onChange={(e) => setAcceptName(e.target.value)}
              placeholder="e.g. Nadia Rahman"
            />
            <p className="text-xs text-muted-foreground">
              Recorded on the proposal, flagged as marked by you rather than signed
              online.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccepting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || acceptName.trim().length < 2}
              onClick={async () => {
                if (!accepting) return;
                setBusy(true);
                const result = await markProposalAccepted(accepting.id, acceptName);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Marked accepted — account, project and deposit invoice created.");
                setAccepting(null);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Mark accepted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              The public link stops working immediately. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                const result = await deleteProposal(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Proposal deleted.");
                setDeleting(null);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
