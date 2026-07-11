"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveMilestone } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ThumbsUp, CheckCircle2 } from "lucide-react";

export function ApproveMilestoneButton({
  milestoneId,
  approvedAt,
}: {
  milestoneId: string;
  approvedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Optimistic: flip to approved immediately, revert on failure.
  const [approved, setApproved] = useState(!!approvedAt);

  if (approved) {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-emerald-600">
        <CheckCircle2 className="size-3.5" /> Approved by you
      </p>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-2 h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setApproved(true);
        setBusy(true);
        const result = await approveMilestone(milestoneId);
        setBusy(false);
        if (!result.ok) {
          setApproved(false);
          toast.error(result.error);
          return;
        }
        toast.success("Milestone approved — thank you!");
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <ThumbsUp />}
      Approve this milestone
    </Button>
  );
}
