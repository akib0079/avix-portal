"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { retainerSchema, scheduleSchema, type RetainerInput } from "@/lib/validation/retainer";
import { createRetainer, updateRetainer } from "@/lib/actions/retainers";
import type { RetainerView } from "@/lib/dal/retainers";
import { paymentTermsOptions } from "@/lib/validation/invoice";
import { CURRENCIES } from "@/lib/currency";
import { addMonths, type Day } from "@/lib/recurring";
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
import {
  ScheduleFields,
  draftFromSchedule,
  scheduleErrors,
  scheduleInput,
  type ScheduleDraft,
  type ScheduleErrors,
} from "./schedule-fields";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import Link from "next/link";

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

/** The form's own fields; the schedule is held beside them (ScheduleFields). */
const planFieldsSchema = retainerSchema.omit({ schedule: true });
type PlanFields = Omit<RetainerInput, "schedule">;

/** A new plan bills on the 1st of next month unless told otherwise. */
function newSchedule(today: Day): ScheduleDraft {
  return {
    frequency: "MONTH",
    interval: 1,
    nextDate: `${addMonths(today, 1).slice(0, 7)}-01`,
    ends: "never",
    endAfterCount: "",
    endDate: "",
    autoSend: false,
  };
}

/**
 * Create or edit a recurring plan. A plan that copies a template invoice
 * takes its lines, amount, currency and terms from that invoice, so those
 * fields are shown but locked here; the client is locked with them.
 */
export function RetainerFormDialog({
  retainer,
  clients,
  projects,
  today,
  open,
  onOpenChange,
}: {
  retainer?: RetainerView | null;
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
  today: Day;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* Mounted per opening and per plan, so it starts from that plan's
            values without an effect copying them in. */}
        {open && (
          <PlanForm
            key={retainer?.id ?? "new"}
            retainer={retainer ?? null}
            clients={clients}
            projects={projects}
            today={today}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanForm({
  retainer,
  clients,
  projects,
  today,
  onDone,
}: {
  retainer: RetainerView | null;
  clients: RetainerClientOption[];
  projects: RetainerProjectOption[];
  today: Day;
  onDone: () => void;
}) {
  const isEdit = !!retainer;
  const templated = !!retainer?.template;
  const [schedule, setSchedule] = useState<ScheduleDraft>(() =>
    retainer
      ? draftFromSchedule({
          frequency: retainer.frequency,
          interval: retainer.interval,
          // An ended plan has no next run: saving restarts it from the date picked.
          nextDate: retainer.nextDay ?? today,
          endAfterCount: retainer.endAfterCount,
          endDay: retainer.endDay,
          autoSend: retainer.autoSend,
        })
      : newSchedule(today),
  );
  const [errors, setErrors] = useState<ScheduleErrors>({});

  const form = useForm<PlanFields>({
    resolver: zodResolver(planFieldsSchema),
    defaultValues: {
      title: retainer?.title ?? "",
      clientId: retainer?.clientId ?? "",
      projectId: retainer?.projectId ?? "none",
      amount: retainer?.amount ?? ("" as unknown as number),
      currency: retainer?.currency ?? "USD",
      // A dollar plan's USD value is its amount (re-mirrored on save), so it
      // isn't seeded: switched to another currency it stood as that value.
      amountUsd: retainer && retainer.currency !== "USD" ? (retainer.amountUsd ?? null) : null,
      paymentTermsDays: retainer ? retainer.paymentTermsDays : 14,
      active: retainer ? retainer.state === "active" : true,
      notes: retainer?.notes ?? "",
    },
  });

  // useWatch rather than form.watch, which the React Compiler can't memoize.
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const clientProjects = projects.filter((p) => p.clientId === clientId || p.clientId === null);

  async function onSubmit(values: PlanFields) {
    const next = scheduleInput(schedule);
    const checked = scheduleSchema.safeParse(next);
    if (!checked.success) return void setErrors(scheduleErrors(checked.error.issues));
    setErrors({});
    const input = { ...values, schedule: checked.data };
    const result = retainer
      ? await updateRetainer(retainer.id, input)
      : await createRetainer(input);
    if (!result.ok) return void toast.error(result.error);
    toast.success(isEdit ? "Plan updated." : "Plan created.");
    // The action revalidates the page; no refresh on top of it.
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading">
          {isEdit ? "Edit recurring plan" : "New recurring plan"}
        </DialogTitle>
        <DialogDescription>
          An invoice is made for every period, on its date. It waits as a draft for you to send,
          unless you choose to send it automatically.
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
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("projectId", "none");
                    }}
                    disabled={templated}
                  >
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

          {templated && retainer?.template && (
            <p className="flex items-start gap-2 rounded-lg border bg-brand-tint/50 px-3 py-2 text-sm">
              <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Each invoice copies{" "}
                <Link
                  href={`/admin/invoices/${retainer.template.id}`}
                  className="font-medium hover:text-primary"
                >
                  {retainer.template.invoiceNumber}
                </Link>
                : its lines, amount, tax and terms. Edit that invoice to change them.
              </span>
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount per invoice</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="250.00"
                      disabled={templated}
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
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={templated}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.label}
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
              name="paymentTermsDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment terms</FormLabel>
                  <Select
                    value={field.value == null ? "none" : String(field.value)}
                    onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    disabled={templated}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Net 14 (default)</SelectItem>
                      {paymentTermsOptions.map((days) => (
                        <SelectItem key={days} value={String(days)}>
                          {days === 0 ? "Due on receipt" : `Net ${days}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {currency !== "USD" && (
            <FormField
              control={form.control}
              name="amountUsd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Each invoice is worth (USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="For your recurring revenue figure"
                      disabled={templated}
                      value={(field.value as number | string | null) ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Only counts toward MRR. Each invoice still gets the USD value it settles at,
                    entered when it&apos;s paid.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="rounded-xl border p-4">
            <ScheduleFields
              value={schedule}
              onChange={setSchedule}
              errors={errors}
              today={today}
              runCount={retainer?.runCount ?? 0}
              dateLabel={isEdit ? "Next invoice on" : "First invoice on"}
              countHint={
                retainer && retainer.runCount > 0
                  ? `${retainer.runCount} made so far count toward this.`
                  : undefined
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
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
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice note (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Printed on each invoice. {{period}} names its period."
                      disabled={templated}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onDone}
              disabled={form.formState.isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              {isEdit ? "Save changes" : "Create plan"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
