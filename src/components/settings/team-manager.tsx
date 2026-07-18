"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { staffSchema, type StaffInput } from "@/lib/validation/staff";
import {
  createStaff,
  setStaffStatus,
  resendStaffInvite,
  deleteStaff,
} from "@/lib/actions/staff";
import { UserStatusBadge, InviteBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Mail, UserRoundCheck, UserRoundX, Users } from "lucide-react";

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  emailVerified: boolean;
  messageCount: number;
};

export function TeamManager({ staff }: { staff: StaffMember[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<StaffMember | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<StaffInput>({
    resolver: zodResolver(staffSchema),
    defaultValues: { firstName: "", lastName: "", email: "" },
  });

  async function onAdd(values: StaffInput) {
    const result = await createStaff(values);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Invite sent — they set their own password.");
    form.reset({ firstName: "", lastName: "", email: "" });
    setAddOpen(false);
    router.refresh();
  }

  async function onToggle(member: StaffMember) {
    setBusyId(member.id);
    const next = member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const result = await setStaffStatus(member.id, next);
    setBusyId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(
      next === "INACTIVE"
        ? "Access revoked — they've been signed out."
        : "Access restored.",
    );
    router.refresh();
  }

  async function onResend(member: StaffMember) {
    setBusyId(member.id);
    const result = await resendStaffInvite(member.id);
    setBusyId(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Invite re-sent to ${member.email}.`);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff can open Projects and client Messages only. They never see
            revenue, invoices, prices or payment details.
          </p>
        </div>
        <Button
          onClick={() => {
            form.reset({ firstName: "", lastName: "", email: "" });
            setAddOpen(true);
          }}
        >
          <Plus /> Add staff
        </Button>
      </div>

      {staff.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No staff yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add a team member to give them limited, money-blind access.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map((m) => (
            <div
              key={m.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                m.status === "INACTIVE" ? "opacity-60" : ""
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                {initials(m.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.name}</p>
                <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <UserStatusBadge status={m.status} />
                <InviteBadge emailVerified={m.emailVerified} />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="Resend invite"
                  disabled={busyId === m.id}
                  onClick={() => onResend(m)}
                >
                  <Mail className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title={m.status === "ACTIVE" ? "Revoke access" : "Restore access"}
                  disabled={busyId === m.id}
                  onClick={() => onToggle(m)}
                >
                  {busyId === m.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : m.status === "ACTIVE" ? (
                    <UserRoundX className="size-4 text-amber-600" />
                  ) : (
                    <UserRoundCheck className="size-4 text-emerald-600" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  title="Delete"
                  onClick={() => setDeleting(m)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add staff */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Add staff member</DialogTitle>
            <DialogDescription>
              They get an email to set their own password. You never handle it.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onAdd)} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input placeholder="Rifat" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ahmed" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="rifat@avixdigital.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                  disabled={form.formState.isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {deleting?.name}?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.messageCount > 0
                ? "They've sent client messages, so the account can't be deleted — revoke access instead to keep the chat history intact."
                : "This permanently deletes their account. They lose access immediately."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || (deleting?.messageCount ?? 0) > 0}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                const result = await deleteStaff(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Staff member removed.");
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
