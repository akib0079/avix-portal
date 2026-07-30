"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  duplicateCampaign,
  pushCampaignBatch,
  queueCampaign,
} from "@/lib/actions/marketing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Send, Copy } from "lucide-react";

/**
 * Send-now + duplicate for a campaign. "Send now" queues the campaign and then
 * pushes bounded batches in a loop, so the page shows progress instead of
 * waiting on the 15-minute duty throttle.
 */
export function CampaignSendControls({
  campaignId,
  status,
  pending,
}: {
  campaignId: string;
  status: string;
  pending: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sentSoFar, setSentSoFar] = useState(0);

  const canSend =
    pending > 0 && ["DRAFT", "SCHEDULED", "QUEUED", "SENDING"].includes(status);

  async function sendNow() {
    setConfirm(false);
    setBusy(true);
    setSentSoFar(0);

    if (status === "DRAFT" || status === "SCHEDULED") {
      const queued = await queueCampaign(campaignId);
      if (!queued.ok) {
        setBusy(false);
        return void toast.error(queued.error);
      }
    }

    // Bounded batches, each its own request — a long list can't time out.
    let left = pending;
    let guard = 0;
    while (left > 0 && guard < 200) {
      guard += 1;
      const res = await pushCampaignBatch(campaignId);
      if (!res.ok) {
        setBusy(false);
        router.refresh();
        return void toast.error(res.error);
      }
      const done = left - (res.data?.remaining ?? 0);
      setSentSoFar((n) => n + Math.max(done, 0));
      if ((res.data?.remaining ?? 0) >= left) break; // no progress — stop looping
      left = res.data?.remaining ?? 0;
      router.refresh();
    }

    setBusy(false);
    router.refresh();
    toast.success("Sending finished.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSend && (
        <Button size="sm" disabled={busy} onClick={() => setConfirm(true)}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          {busy ? `Sending… ${sentSoFar}/${pending}` : "Send now"}
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await duplicateCampaign(campaignId);
          setBusy(false);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Copied to a new draft.");
          router.push(`/admin/marketing/${res.data!.id}`);
        }}
      >
        <Copy /> Duplicate
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to {pending} recipient{pending === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Emails go out in batches of 25. Keep this page open to watch it
              finish — if you close it, the background job picks up the rest.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={sendNow}>
              <Send /> Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
