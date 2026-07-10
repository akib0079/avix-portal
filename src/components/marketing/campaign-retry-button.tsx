"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryCampaignRecipients } from "@/lib/actions/marketing";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

export function CampaignRetryButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await retryCampaignRecipients(campaignId);
        setBusy(false);
        if (!result.ok) return void toast.error(result.error);
        toast.success("Retry finished.");
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      {busy ? "Retrying…" : "Retry failed"}
    </Button>
  );
}
