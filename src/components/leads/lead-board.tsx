"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import type { LeadView } from "@/lib/dal/leads";
import { leadStageLabels, leadSourceLabels } from "@/lib/validation/lead";
import { setLeadStage, deleteLead, convertLead } from "@/lib/actions/leads";
import { LeadFormDialog } from "./lead-form-dialog";
import { Button } from "@/components/ui/button";
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
import { usd, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CalendarClock,
  UserRoundPlus,
  BadgeDollarSign,
  CheckCircle2,
} from "lucide-react";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"];

const stageAccents: Record<LeadStage, string> = {
  NEW: "border-t-sky-400",
  CONTACTED: "border-t-amber-400",
  PROPOSAL: "border-t-violet-400",
  WON: "border-t-emerald-400",
  LOST: "border-t-slate-300",
};

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(`${date}T23:59:59`) < new Date();
}

export function LeadBoard({ leads }: { leads: LeadView[] }) {
  const router = useRouter();
  const [items, setItems] = useState(leads);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LeadView | null>(null);
  const [deleting, setDeleting] = useState<LeadView | null>(null);
  const [converting, setConverting] = useState<LeadView | null>(null);
  const [busy, setBusy] = useState(false);

  // Sync with server data after router.refresh (adjust-during-render).
  const [prevLeads, setPrevLeads] = useState(leads);
  if (leads !== prevLeads) {
    setPrevLeads(leads);
    setItems(leads);
  }

  // Optimistic stage move with revert on failure.
  async function moveStage(lead: LeadView, stage: LeadStage) {
    const previous = items;
    setItems(items.map((l) => (l.id === lead.id ? { ...l, stage } : l)));
    const result = await setLeadStage(lead.id, stage);
    if (!result.ok) {
      setItems(previous);
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function onConvert(lead: LeadView) {
    setBusy(true);
    const result = await convertLead(lead.id);
    setBusy(false);
    setConverting(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Client created — invite email sent. Set up their first project.");
    router.push(`/admin/projects/new?clientId=${result.data!.clientId}`);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> Add lead
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const stageLeads = items.filter((l) => l.stage === stage);
          const stageValue = stageLeads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);
          return (
            <div key={stage} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold">
                  {leadStageLabels[stage]}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({stageLeads.length})
                  </span>
                </h2>
                {stageValue > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {usd.format(stageValue)}
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {stageLeads.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className={cn(
                        "rounded-xl border border-t-4 bg-card p-3.5",
                        stageAccents[lead.stage],
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{lead.name}</p>
                          {lead.company && (
                            <p className="truncate text-xs text-muted-foreground">
                              {lead.company}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {leadSourceLabels[lead.source]}
                        </span>
                      </div>

                      {lead.estimatedValue != null && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary">
                          <BadgeDollarSign className="size-3" />
                          {usd.format(lead.estimatedValue)}
                        </p>
                      )}
                      {lead.nextFollowUp && lead.stage !== "WON" && lead.stage !== "LOST" && (
                        <p
                          className={cn(
                            "mt-1 flex items-center gap-1 text-xs",
                            isOverdue(lead.nextFollowUp)
                              ? "font-semibold text-red-600"
                              : "text-muted-foreground",
                          )}
                        >
                          <CalendarClock className="size-3" />
                          Follow up {formatDate(lead.nextFollowUp)}
                          {isOverdue(lead.nextFollowUp) && " — overdue"}
                        </p>
                      )}
                      {lead.notes && (
                        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                          {lead.notes}
                        </p>
                      )}
                      {lead.convertedClientId && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="size-3" /> Client created
                        </p>
                      )}

                      <div className="mt-3 flex items-center gap-1 border-t pt-2.5">
                        <Select
                          value={lead.stage}
                          onValueChange={(v) => moveStage(lead, v as LeadStage)}
                        >
                          <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {leadStageLabels[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!lead.convertedClientId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-emerald-600 hover:text-emerald-700"
                            title="Convert to client"
                            onClick={() => setConverting(lead)}
                          >
                            <UserRoundPlus className="size-3.5" />
                            <span className="sr-only">Convert to client</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setEditing(lead);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(lead)}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LeadFormDialog lead={editing} open={formOpen} onOpenChange={setFormOpen} />

      <Dialog open={!!converting} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert “{converting?.name}” to a client?</DialogTitle>
            <DialogDescription>
              Creates their portal account ({converting?.email ?? "no email set"}),
              emails them an invite to set a password, and takes you to create
              their first project.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !converting?.email} onClick={() => converting && onConvert(converting)}>
              {busy ? <Loader2 className="animate-spin" /> : <UserRoundPlus />}
              Convert to client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>This removes the lead permanently.</DialogDescription>
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
                const previous = items;
                setItems(items.filter((l) => l.id !== deleting.id));
                setDeleting(null);
                setBusy(true);
                const result = await deleteLead(deleting.id);
                setBusy(false);
                if (!result.ok) {
                  setItems(previous);
                  toast.error(result.error);
                  return;
                }
                toast.success("Lead deleted.");
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
