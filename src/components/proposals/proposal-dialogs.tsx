"use client";

import { useEffect, useState } from "react";
import type { ProposalCard, ProposalDetail } from "@/lib/dal/proposals";
import {
  deleteProposal,
  duplicateProposal,
  extendProposal,
  loadProposalDetail,
  markProposalAccepted,
} from "@/lib/actions/proposals";
import { setLeadStage } from "@/lib/actions/leads";
import { formatCurrency } from "@/lib/currency";
import { invoiceStatusLabels } from "@/lib/format";
import { proposalValidityDays } from "@/lib/validation/proposal";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ProposalLeadOption } from "./proposal-form-dialog";

/**
 * Loads one proposal's detail when it is opened, and again whenever
 * `refreshKey` changes (the board passes the card's data, so an action that
 * re-renders the board refreshes an open sheet too). While a refresh is in
 * flight the last result for the same proposal stays on screen.
 */
export function useProposalDetail(id: string | null, refreshKey = "") {
  const [state, setState] = useState<{
    id: string;
    key: string;
    detail: ProposalDetail | null;
    error: string | null;
  } | null>(null);
  const key = id ? `${id}\u0000${refreshKey}` : null;

  useEffect(() => {
    if (!id || !key) return;
    let live = true;
    loadProposalDetail(id).then(
      (result) => {
        if (!live) return;
        setState({
          id,
          key,
          detail: result.ok ? (result.data ?? null) : null,
          error: result.ok ? null : result.error,
        });
      },
      () => {
        if (live) setState({ id, key, detail: null, error: "Couldn't load this proposal." });
      },
    );
    return () => {
      live = false;
    };
  }, [id, key]);

  const current = state && state.id === id ? state : null;
  return {
    detail: current?.detail ?? null,
    error: current?.error ?? null,
    loading: key != null && state?.key !== key,
  };
}

/** Why an invoice can't go with the proposal, in the words of draftInvoiceRemovable. */
function keptBecause(invoice: NonNullable<ProposalDetail["invoice"]>): string {
  if (invoice.sentAt) return "it has already been sent";
  if (invoice.amountPaid > 0 || invoice.paymentCount > 0) return "money has been recorded against it";
  return `it is ${invoiceStatusLabels[invoice.status].toLowerCase()}`;
}

function DetailLoading() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Checking what this affects…
    </div>
  );
}

/**
 * Delete, as it applies to this proposal (proposalRemovalPlan). The dialog
 * says exactly what happens before anything does: an unsent draft goes for
 * good, anything sent is archived, and an accepted one keeps its client,
 * project and invoice.
 */
export function ProposalRemoveDialog({
  proposal,
  onClose,
}: {
  proposal: ProposalCard;
  onClose: (removed: boolean) => void;
}) {
  const { detail, error, loading } = useProposalDetail(proposal.id);
  const [removeInvoice, setRemoveInvoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const plan = detail?.removal;
  const invoice = detail?.invoice;

  async function confirm() {
    setBusy(true);
    const result = await deleteProposal(proposal.id, { removeInvoice });
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    const done = result.data!;
    toast.success(
      done.mode === "deleted"
        ? `Proposal deleted${done.invoiceRemoved ? " with its draft invoice" : ""}.`
        : `Proposal archived${done.invoiceRemoved ? " and its draft invoice removed" : ""}. Find it under Archived.`,
    );
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{proposal.title}”?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {loading && <DetailLoading />}
              {error && <p className="text-destructive">{error}</p>}
              {plan?.mode === "delete" && (
                <>
                  <p>It was never sent, so it&apos;s removed for good.</p>
                  {invoice && plan.invoice === "remove" && (
                    <p>Its draft invoice {invoice.invoiceNumber} goes with it.</p>
                  )}
                  {invoice && plan.invoice === "keep" && (
                    <p>
                      Invoice {invoice.invoiceNumber} stays: {keptBecause(invoice)}.
                    </p>
                  )}
                </>
              )}
              {plan?.mode === "archive" && proposal.status === "ACCEPTED" && (
                <p>
                  Accepted proposals are archived, not erased: it leaves the board but stays on
                  record, and the client can still open their copy. The client
                  {detail?.projectName ? `, the project “${detail.projectName}”` : ""}
                  {invoice ? ` and invoice ${invoice.invoiceNumber}` : ""} stay as they are.
                </p>
              )}
              {plan?.mode === "archive" && proposal.status !== "ACCEPTED" && (
                <p>
                  It has been sent, so it&apos;s archived rather than erased: it leaves the
                  board and the client&apos;s link stops working (it will say the proposal was
                  withdrawn). You can restore it from Archived.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {plan?.invoice === "offer" && invoice && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={removeInvoice}
              onChange={(e) => setRemoveInvoice(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span>
              Also remove the draft invoice {invoice.invoiceNumber} (
              {formatCurrency(invoice.amount, invoice.currency)})
              <span className="block text-xs text-muted-foreground">
                It was never sent and nothing has been paid on it.
              </span>
            </span>
          </label>
        )}
        {plan?.mode === "archive" && plan.invoice === "keep" && invoice && proposal.status !== "ACCEPTED" && (
          <p className="text-xs text-muted-foreground">
            Invoice {invoice.invoiceNumber} stays: {keptBecause(invoice)}.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || !plan} onClick={confirm}>
            {busy && <Loader2 className="animate-spin" />}
            {plan?.mode === "archive" ? "Archive proposal" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "They agreed by call or chat": the same hand-off as the client accepting online. */
export function ProposalAcceptDialog({
  proposal,
  onClose,
}: {
  proposal: ProposalCard;
  onClose: () => void;
}) {
  const { detail, loading } = useProposalDetail(proposal.id);
  const [name, setName] = useState(proposal.contactName);
  const [busy, setBusy] = useState(false);
  const first = detail?.firstInvoice;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark “{proposal.title}” as accepted?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Use this when they agreed by call, chat or email. It runs the same set-up as
                accepting online:
              </p>
              {loading ? (
                <DetailLoading />
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  <li>a contract project, priced at {formatCurrency(proposal.total, proposal.currency)}</li>
                  {first?.kind === "invoice" && detail?.invoice && (
                    <li>
                      invoice {detail.invoice.invoiceNumber} (
                      {formatCurrency(first.amount, first.currency)}) attached to it, ready to send
                    </li>
                  )}
                  {first?.kind === "deposit" && (
                    <li>
                      a {first.percent}% deposit invoice ({formatCurrency(first.amount, first.currency)})
                    </li>
                  )}
                  <li>
                    {detail?.client?.hasLogin
                      ? `the project in ${detail.client.name}'s portal (they already have a login)`
                      : "a portal invite to the client's email, so they can set a password"}
                  </li>
                </ul>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="accept-name">Who agreed?</Label>
          <Input
            id="accept-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nadia Rahman"
          />
          <p className="text-xs text-muted-foreground">
            Recorded on the proposal, flagged as marked by you rather than signed online.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              const result = await markProposalAccepted(proposal.id, name);
              setBusy(false);
              if (!result.ok) return void toast.error(result.error);
              toast.success(
                result.data?.alreadyAccepted
                  ? "It was already accepted — nothing was created twice."
                  : "Marked accepted — project and invoice are ready.",
              );
              onClose();
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            Mark accepted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DuplicateTarget = "same" | "lead" | "manual";

/** A new draft from this one, optionally for someone else; the builder opens on it. */
export function ProposalDuplicateDialog({
  proposal,
  leads,
  onClose,
  onDuplicated,
}: {
  proposal: ProposalCard;
  leads: ProposalLeadOption[];
  onClose: () => void;
  onDuplicated: (id: string) => void;
}) {
  const [target, setTarget] = useState<DuplicateTarget>("same");
  const [leadId, setLeadId] = useState("");
  const [manual, setManual] = useState({ name: "", email: "", company: "" });
  const [busy, setBusy] = useState(false);

  const ready =
    target === "same" ||
    (target === "lead" && leadId !== "") ||
    (target === "manual" && manual.name.trim() !== "" && manual.email.trim() !== "");

  async function confirm() {
    setBusy(true);
    const result = await duplicateProposal(
      proposal.id,
      target === "lead"
        ? { source: "lead", leadId }
        : target === "manual"
          ? {
              source: "manual",
              recipientName: manual.name,
              recipientEmail: manual.email,
              recipientCompany: manual.company,
            }
          : { source: "same" },
    );
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Copy created as a draft — review it before sending.");
    onDuplicated(result.data!.id);
  }

  const options: { value: DuplicateTarget; label: string; disabled?: boolean }[] = [
    { value: "same", label: `Same recipient (${proposal.contactName})` },
    { value: "lead", label: "A lead in my pipeline", disabled: leads.length === 0 },
    { value: "manual", label: "Someone else" },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate “{proposal.title}”</DialogTitle>
          <DialogDescription>
            Copies the scope, terms, currency, deposit, timeline and validity into a new
            draft with its own draft invoice. Nothing is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>For</Label>
          <div className="grid gap-2">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => setTarget(opt.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  target === opt.value
                    ? "border-primary bg-brand-tint font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {target === "lead" && (
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select lead" />
              </SelectTrigger>
              <SelectContent>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                    {l.company ? ` — ${l.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {target === "manual" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dup-name">Name</Label>
                <Input
                  id="dup-name"
                  value={manual.name}
                  onChange={(e) => setManual({ ...manual, name: e.target.value })}
                  placeholder="e.g. Nadia Rahman"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dup-email">Email</Label>
                <Input
                  id="dup-email"
                  type="email"
                  value={manual.email}
                  onChange={(e) => setManual({ ...manual, email: e.target.value })}
                  placeholder="nadia@verdant.co"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dup-company">Company (optional)</Label>
                <Input
                  id="dup-company"
                  value={manual.company}
                  onChange={(e) => setManual({ ...manual, company: e.target.value })}
                  placeholder="Verdant Skincare"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !ready} onClick={confirm}>
            {busy && <Loader2 className="animate-spin" />}
            Duplicate and edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** More time: a new expiry and a new link, emailed; the old link stops working. */
export function ProposalExtendDialog({
  proposal,
  onClose,
}: {
  proposal: ProposalCard;
  onClose: () => void;
}) {
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {proposal.status === "EXPIRED" ? "Extend and resend" : "Extend"} “{proposal.title}”
          </DialogTitle>
          <DialogDescription>
            {proposal.contactEmail ?? "The recipient"} gets an email with a new link, open for the
            time you choose. The link they had before stops working.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Open for</Label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {proposalValidityDays.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} days from today
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await extendProposal(proposal.id, days);
              setBusy(false);
              if (!result.ok) return void toast.error(result.error);
              toast.success(`Extended — a new link is on its way to ${proposal.contactEmail}.`);
              onClose();
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            Extend and send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A decline never moves the lead by itself; this is the owner deciding that
 * it does. The decline reason, when there is one, starts the lost reason.
 */
export function LeadLostDialog({
  proposal,
  onClose,
}: {
  proposal: ProposalCard;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(
    proposal.declineReason ? `Declined the proposal: ${proposal.declineReason}` : "Declined the proposal",
  );
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {proposal.contactName} as lost?</DialogTitle>
          <DialogDescription>
            Moves the lead to Lost in your pipeline. The proposal stays as it is.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !reason.trim() || !proposal.leadId}
            onClick={async () => {
              if (!proposal.leadId) return;
              setBusy(true);
              const result = await setLeadStage(proposal.leadId, "LOST", reason);
              setBusy(false);
              if (!result.ok) return void toast.error(result.error);
              toast.success("Lead marked as lost.");
              onClose();
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            Mark lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
