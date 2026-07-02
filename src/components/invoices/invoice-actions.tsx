"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import {
  setInvoiceStatus,
  sendInvoice,
  deleteInvoice,
} from "@/lib/actions/invoices";
import { invoiceStatusLabels } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
import { Send, Trash2, Loader2 } from "lucide-react";

export function InvoiceStatusSelect({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  return (
    <Select
      value={status}
      onValueChange={async (value) => {
        const result = await setInvoiceStatus(invoiceId, value as InvoiceStatus);
        if (!result.ok) return void toast.error(result.error);
        router.refresh();
      }}
    >
      <SelectTrigger size="sm" className="w-[120px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(invoiceStatusLabels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SendInvoiceButton({
  invoiceId,
  clientEmail,
  size = "sm",
}: {
  invoiceId: string;
  clientEmail: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size={size}
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await sendInvoice(invoiceId);
        setBusy(false);
        if (!result.ok) return void toast.error(result.error);
        toast.success(`Invoice emailed to ${clientEmail}.`);
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Send />}
      Send to client
    </Button>
  );
}

export function DeleteInvoiceButton({
  invoiceId,
  invoiceNumber,
  redirectAfterDelete,
}: {
  invoiceId: string;
  invoiceNumber: string;
  redirectAfterDelete?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Delete invoice</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete invoice {invoiceNumber}?</DialogTitle>
            <DialogDescription>
              This permanently removes the invoice and its PDF. This can&apos;t
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await deleteInvoice(invoiceId);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Invoice deleted.");
                setOpen(false);
                if (redirectAfterDelete) router.push(redirectAfterDelete);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
