"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RetainerView } from "@/lib/dal/retainers";
import { deleteRetainer } from "@/lib/actions/retainers";
import {
  RetainerFormDialog,
  type RetainerClientOption,
  type RetainerProjectOption,
} from "./retainer-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Repeat, PauseCircle } from "lucide-react";

export function RetainerManager({
  retainers,
  clients,
  projects,
}: {
  retainers: RetainerView[];
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RetainerView | null>(null);
  const [deleting, setDeleting] = useState<RetainerView | null>(null);
  const [busy, setBusy] = useState(false);

  const monthlyTotal = retainers
    .filter((r) => r.active)
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Recurring revenue:{" "}
          <span className="font-semibold text-foreground">
            {usd.format(monthlyTotal)}/month
          </span>{" "}
          across {retainers.filter((r) => r.active).length} active plan
          {retainers.filter((r) => r.active).length === 1 ? "" : "s"}
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> New retainer
        </Button>
      </div>

      {retainers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Repeat className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No retainers yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Set up a monthly plan — an invoice is drafted automatically each
            month for you to review and send.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {retainers.map((r) => (
            <div
              key={r.id}
              className={cn("rounded-xl border bg-card p-4", !r.active && "opacity-60")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {r.active ? (
                      <Repeat className="size-4 text-primary" />
                    ) : (
                      <PauseCircle className="size-4 text-muted-foreground" />
                    )}
                    {r.title}
                    {!r.active && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Paused
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.clientName}
                    {r.projectName ? ` · ${r.projectName}` : ""} · bills on day{" "}
                    {r.dayOfMonth}
                    {r.lastGeneratedPeriod
                      ? ` · last drafted ${r.lastGeneratedPeriod}`
                      : " · nothing drafted yet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-heading text-lg font-bold text-primary">
                    {usd.format(r.amount)}
                    <span className="text-xs font-normal text-muted-foreground">/mo</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      setEditing(r);
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
                    onClick={() => setDeleting(r)}
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

      <RetainerFormDialog
        retainer={editing}
        clients={clients}
        projects={projects}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription>
              Already-drafted invoices are kept; no future ones will be created.
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
                const result = await deleteRetainer(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Retainer deleted.");
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
