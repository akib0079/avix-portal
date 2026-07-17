"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { retainerSchema, type RetainerInput } from "@/lib/validation/retainer";
import { createRetainer, updateRetainer } from "@/lib/actions/retainers";
import type { RetainerView } from "@/lib/dal/retainers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export type RetainerClientOption = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
};
export type RetainerProjectOption = {
  id: string;
  projectName: string;
  clientId: string | null;
};

export function RetainerFormDialog({
  retainer,
  clients,
  projects,
  open,
  onOpenChange,
}: {
  retainer?: RetainerView | null;
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = !!retainer;

  const form = useForm<RetainerInput>({
    resolver: zodResolver(retainerSchema),
    defaultValues: {
      title: "",
      clientId: "",
      projectId: "none",
      amount: "" as unknown as number,
      dayOfMonth: 1,
      active: true,
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        title: retainer?.title ?? "",
        clientId: retainer?.clientId ?? "",
        projectId: retainer?.projectId ?? "none",
        amount: retainer?.amount ?? ("" as unknown as number),
        dayOfMonth: retainer?.dayOfMonth ?? 1,
        active: retainer?.active ?? true,
        notes: retainer?.notes ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, retainer?.id]);

  const clientId = form.watch("clientId");
  const clientProjects = projects.filter(
    (p) => p.clientId === clientId || p.clientId === null,
  );

  async function onSubmit(values: RetainerInput) {
    const result = isEdit
      ? await updateRetainer(retainer.id, values)
      : await createRetainer(values);
    if (!result.ok) return void toast.error(result.error);
    toast.success(isEdit ? "Retainer updated." : "Retainer created.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit retainer" : "New retainer"}
          </DialogTitle>
          <DialogDescription>
            Each month an invoice is drafted automatically on the chosen day —
            you review and send it, nothing goes out on its own.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Monthly maintenance" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.firstName} {c.lastName}
                            {c.company ? ` — ${c.company}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project (optional)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Not linked" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not linked</SelectItem>
                        {clientProjects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.projectName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly amount ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="250.00"
                        value={(field.value as number | string) ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? ("" as unknown as number)
                              : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dayOfMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bill on day</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-64">
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value ? "active" : "paused"}
                      onValueChange={(v) => field.onChange(v === "active")}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice note (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Appears on each generated invoice…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                {isEdit ? "Save changes" : "Create retainer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
