"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentAccountView } from "@/lib/dal/settings";
import { paymentRegionLabels } from "@/lib/validation/payment";
import { deletePaymentAccount } from "@/lib/actions/settings";
import { PaymentAccountFormDialog } from "./payment-account-form-dialog";
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
import { Plus, Pencil, Trash2, Loader2, Landmark, EyeOff } from "lucide-react";

export function PaymentAccountManager({
  accounts,
}: {
  accounts: PaymentAccountView[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentAccountView | null>(null);
  const [deleting, setDeleting] = useState<PaymentAccountView | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Payment accounts</h2>
          <p className="text-sm text-muted-foreground">
            Bank-transfer details clients use to pay invoices.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> Add account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No payment accounts yet — add your first one.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex items-center gap-2 font-medium">
                      <Landmark className="size-4 text-primary" />
                      {account.title}
                    </p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {paymentRegionLabels[account.region]}
                    </span>
                    {!account.isActive && (
                      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        <EyeOff className="size-3" /> Hidden
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {account.holderName} · {account.bankName} ·{" "}
                    {account.fields.length} field
                    {account.fields.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      setEditing(account);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(account)}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PaymentAccountFormDialog
        account={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              Clients will no longer see these payment details. This can&apos;t
              be undone.
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
                const result = await deletePaymentAccount(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Payment account deleted.");
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
