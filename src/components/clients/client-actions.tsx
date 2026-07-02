"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  resendInvite,
  setClientStatus,
  deleteClient,
} from "@/lib/actions/clients";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { MoreHorizontal, MailPlus, UserX, UserCheck, Trash2, Loader2 } from "lucide-react";

export function ClientActions({
  client,
}: {
  client: {
    id: string;
    name: string;
    status: "ACTIVE" | "INACTIVE";
    emailVerified: boolean;
  };
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? "Something went wrong.");
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
            <span className="sr-only">Client actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!client.emailVerified && (
            <DropdownMenuItem
              onClick={() => run(() => resendInvite(client.id), "Invite email re-sent.")}
            >
              <MailPlus /> Resend invite
            </DropdownMenuItem>
          )}
          {client.status === "ACTIVE" ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => setClientStatus(client.id, "INACTIVE"),
                  "Client deactivated — they can no longer sign in.",
                )
              }
            >
              <UserX /> Deactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                run(() => setClientStatus(client.id, "ACTIVE"), "Client reactivated.")
              }
            >
              <UserCheck /> Reactivate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {client.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the client account and their task
              requests. Their projects are kept and marked as independent.
              Clients with invoices can&apos;t be deleted — deactivate them
              instead.
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
                const ok = await run(
                  () => deleteClient(client.id),
                  "Client deleted.",
                );
                if (ok) {
                  setConfirmDelete(false);
                  router.push("/admin/clients");
                }
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
