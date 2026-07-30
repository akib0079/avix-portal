"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadView, LeadOwnerOption } from "@/lib/dal/leads";
import { convertLead, deleteLead, setLeadStage } from "@/lib/actions/leads";
import { leadStageLabels, leadStageValues } from "@/lib/validation/lead";
import { LeadFormDialog } from "./lead-form-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2, UserPlus, Loader2 } from "lucide-react";

/** Stage switcher + edit / convert / delete for the lead detail page. */
export function LeadDetailActions({
  lead,
  owners,
  proposalCount,
}: {
  lead: LeadView;
  owners: LeadOwnerOption[];
  proposalCount: number;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function changeStage(next: string) {
    if (next === lead.stage) return;
    // Losing a lead needs a reason — ask before firing the action.
    if (next === "LOST") return setLostFor(next);
    setBusy(true);
    const res = await setLeadStage(lead.id, next as never);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Moved to ${leadStageLabels[next as never]}.`);
    router.refresh();
  }

  async function confirmLost() {
    setBusy(true);
    const res = await setLeadStage(lead.id, "LOST", reason);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setLostFor(null);
    setReason("");
    toast.success("Marked as lost.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={lead.stage} onValueChange={changeStage} disabled={busy}>
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {leadStageValues.map((s) => (
            <SelectItem key={s} value={s}>
              {leadStageLabels[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="size-3.5" /> Edit
      </Button>

      {!lead.convertedClientId && (
        <Button variant="outline" size="sm" onClick={() => setConfirmConvert(true)}>
          <UserPlus className="size-3.5" /> Convert
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="size-3.5" /> Delete
      </Button>

      <LeadFormDialog lead={lead} owners={owners} open={editOpen} onOpenChange={setEditOpen} />

      {/* Lost reason */}
      <Dialog open={!!lostFor} onOpenChange={(o) => !o && setLostFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why was this lead lost?</DialogTitle>
            <DialogDescription>
              A short reason makes the pipeline worth learning from later.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Budget too low, went with an in-house team…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              Cancel
            </Button>
            <Button onClick={confirmLost} disabled={busy || !reason.trim()}>
              {busy && <Loader2 className="animate-spin" />} Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert */}
      <Dialog open={confirmConvert} onOpenChange={setConfirmConvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert {lead.name} to a client?</DialogTitle>
            <DialogDescription>
              Creates a portal account for {lead.email ?? "this lead"} and emails them a
              set-your-password link. The lead is marked Won.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmConvert(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await convertLead(lead.id);
                setBusy(false);
                if (!res.ok) return void toast.error(res.error);
                setConfirmConvert(false);
                toast.success("Client created — invite sent.");
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />} Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {lead.name}?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone.
              {proposalCount > 0 && (
                <>
                  {" "}
                  <span className="font-medium text-destructive">
                    {proposalCount} proposal{proposalCount === 1 ? "" : "s"} attached to
                    this lead will be deleted too.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await deleteLead(lead.id);
                setBusy(false);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Lead deleted.");
                router.push("/admin/leads");
              }}
            >
              {busy && <Loader2 className="animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
