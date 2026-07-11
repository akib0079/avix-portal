"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { claimInvoicePayment } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, HandCoins, Hourglass } from "lucide-react";

export function ClaimPaymentButton({
  invoiceId,
  claimed,
}: {
  invoiceId: string;
  claimed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(claimed);

  if (reported) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-amber-700">
        <Hourglass className="size-4" /> Payment reported — awaiting confirmation
      </p>
    );
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setReported(true);
        setBusy(true);
        const result = await claimInvoicePayment(invoiceId);
        setBusy(false);
        if (!result.ok) {
          setReported(false);
          toast.error(result.error);
          return;
        }
        toast.success("Thanks! We'll confirm the payment shortly.");
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <HandCoins />}
      I&apos;ve sent the payment
    </Button>
  );
}
