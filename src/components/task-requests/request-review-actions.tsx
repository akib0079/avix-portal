"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  approvalPricingSchema,
  type ApprovalPricingInput,
} from "@/lib/validation/task-request";
import {
  approveTaskRequest,
  rejectTaskRequest,
} from "@/lib/actions/task-requests";
import { PricingFields } from "@/components/milestones/pricing-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, X, Loader2 } from "lucide-react";

export function RequestReviewActions({
  request,
}: {
  request: { id: string; title: string; clientName: string };
}) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const form = useForm<ApprovalPricingInput>({
    resolver: zodResolver(approvalPricingSchema),
    defaultValues: {
      pricingType: "NONE",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: null,
    },
  });

  async function onApprove(values: ApprovalPricingInput) {
    const result = await approveTaskRequest(request.id, values);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Approved — added to the project board.");
    setApproveOpen(false);
    router.refresh();
  }

  async function onReject() {
    setBusy(true);
    const result = await rejectTaskRequest(request.id, reason);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Request rejected — the client has been notified.");
    setRejectOpen(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => setApproveOpen(true)}>
        <Check /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setRejectOpen(true)}
      >
        <X /> Reject
      </Button>

      {/* Approve: set pricing before converting to a milestone */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Approve request</DialogTitle>
            <DialogDescription>
              Set the pricing for “{request.title}”. It becomes a milestone on
              the project board and {request.clientName} is notified.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onApprove)} className="space-y-4">
              <PricingFields form={form} />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setApproveOpen(false)}
                  disabled={form.formState.isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                  Approve & add to board
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reject: reason is required and emailed to the client */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Reject request</DialogTitle>
            <DialogDescription>
              Tell {request.clientName} why — the note is emailed to them and
              shown in their portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              placeholder="e.g. This is outside the current project scope — happy to quote it separately."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onReject}
              disabled={busy || reason.trim().length < 3}
            >
              {busy && <Loader2 className="animate-spin" />}
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
