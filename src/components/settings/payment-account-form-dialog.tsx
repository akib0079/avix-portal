"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  paymentAccountSchema,
  type PaymentAccountInput,
  paymentRegionLabels,
  paymentRegionValues,
} from "@/lib/validation/payment";
import {
  createPaymentAccount,
  updatePaymentAccount,
} from "@/lib/actions/settings";
import type { PaymentAccountView } from "@/lib/dal/settings";
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
import { Loader2, Plus, Trash2 } from "lucide-react";

const EMPTY: PaymentAccountInput = {
  title: "",
  region: "US_ACH",
  holderName: "",
  bankName: "",
  bankNote: "",
  note: "",
  isActive: true,
  fields: [{ label: "", value: "" }],
};

export function PaymentAccountFormDialog({
  account,
  open,
  onOpenChange,
}: {
  account?: PaymentAccountView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = !!account;

  const form = useForm<PaymentAccountInput>({
    resolver: zodResolver(paymentAccountSchema),
    defaultValues: EMPTY,
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "fields",
  });

  useEffect(() => {
    if (open) {
      form.reset(
        account
          ? {
              title: account.title,
              region: account.region,
              holderName: account.holderName,
              bankName: account.bankName,
              bankNote: account.bankNote ?? "",
              note: account.note ?? "",
              isActive: account.isActive,
              fields: account.fields.length ? account.fields : [{ label: "", value: "" }],
            }
          : EMPTY,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  async function onSubmit(values: PaymentAccountInput) {
    const result = isEdit
      ? await updatePaymentAccount(account.id, values)
      : await createPaymentAccount(values);
    if (!result.ok) return void toast.error(result.error);
    toast.success(isEdit ? "Payment account updated." : "Payment account added.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit payment account" : "Add payment account"}
          </DialogTitle>
          <DialogDescription>
            Clients see active accounts on invoices and the “How to pay” page.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="USA (USD) — ACH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="region"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {paymentRegionValues.map((r) => (
                        <SelectItem key={r} value={r}>
                          {paymentRegionLabels[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="holderName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account holder</FormLabel>
                    <FormControl>
                      <Input placeholder="Md Akib Zawayed" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank name</FormLabel>
                    <FormControl>
                      <Input placeholder="JPMorgan Chase" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="bankNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank note (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Bank based in the US · New York, NY" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <FormLabel>Fields</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ label: "", value: "" })}
                >
                  <Plus /> Add field
                </Button>
              </div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <FormField
                      control={form.control}
                      name={`fields.${i}.label`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Label (e.g. IBAN)" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`fields.${i}.value`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Value" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => fields.length > 1 && remove(i)}
                      disabled={fields.length <= 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note to client (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="For clients paying from the USA in USD."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Show to clients</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Inactive accounts stay hidden on invoices.
                    </p>
                  </div>
                  <FormControl>
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--primary)]"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
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
                {isEdit ? "Save changes" : "Add account"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
