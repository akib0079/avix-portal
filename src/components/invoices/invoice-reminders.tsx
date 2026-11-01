"use client";

import { useOptimistic, useTransition } from "react";
import { setInvoiceReminders } from "@/lib/actions/invoices";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BellOff, BellRing, Loader2 } from "lucide-react";

/**
 * Where the automatic reminders stand for one invoice, and the switch to stop
 * them: for when the owner has agreed something with the client and the
 * chaser should keep quiet. The summary is worked out on the server from the
 * same schedule the duty runs (lib/invoice-reminders).
 */
export function InvoiceReminders({
  invoiceId,
  paused,
  summary,
}: {
  invoiceId: string;
  paused: boolean;
  summary: string;
}) {
  const [shown, setShown] = useOptimistic(paused);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
      <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-muted-foreground">
        {shown ? (
          <BellOff className="mt-0.5 size-4 shrink-0" />
        ) : (
          <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0">{summary}</span>
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setShown(!shown);
            // Revalidates the page, which brings the new summary with it.
            const result = await setInvoiceReminders(invoiceId, !shown);
            if (!result.ok) toast.error(result.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        {shown ? "Resume reminders" : "Pause reminders"}
      </Button>
    </div>
  );
}
