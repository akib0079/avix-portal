"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
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

const statusStyles: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  DECLINED: "bg-red-50 text-red-700",
  EXPIRED: "bg-amber-50 text-amber-700",
};

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
}: {
  proposals: ProposalView[];
  leads: ProposalLeadOption[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProposalView | null>(null);
  const [deleting, setDeleting] = useState<ProposalView | null>(null);
  const [accepting, setAccepting] = useState<ProposalView | null>(null);
  const [acceptName, setAcceptName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> New proposal
        </Button>
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
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div key={p.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {p.status === "ACCEPTED" ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <FileSignature className="size-4 text-primary" />
                    )}
                    {p.title}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        statusStyles[p.status],
                      )}
                    >
                      {proposalStatusLabels[p.status]}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
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
                    {p.status === "SENT" && p.expiresAt
                      ? ` · valid until ${formatDate(p.expiresAt)}`
                      : ""}
                    {p.status === "DRAFT" ? " · not sent yet" : ""}
                  </p>

                  {p.status === "ACCEPTED" && (
                    <p className="mt-1.5 text-sm text-emerald-700">
                      {p.acceptedByAdmin ? "Recorded as agreed by " : "Signed by "}
                      <strong>{p.acceptedName}</strong> on {formatDate(p.acceptedAt)}
                      {p.acceptedByAdmin ? " (marked by you)" : ""}
                      {p.convertedProjectId && (
                        <>
                          {" · "}
                          <Link
                            href={`/admin/projects/${p.convertedProjectId}`}
                            className="underline hover:text-emerald-800"
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
                            className="underline hover:text-emerald-800"
                          >
                            Deposit invoice
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="font-heading text-lg font-bold text-primary">
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
                      className="text-emerald-600 hover:text-emerald-700"
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
          ))}
        </div>
      )}

      <ProposalFormDialog
        proposal={editing}
        leads={leads}
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
