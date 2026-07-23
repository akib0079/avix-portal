"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/invoice";
import { createInvoice, updateInvoice } from "@/lib/actions/invoices";
import { invoiceStatusLabels } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useActivity } from "@/components/layout/activity-indicator";
import { cn } from "@/lib/utils";
import { Loader2, FileText, Upload, Link2, Plus, Trash2 } from "lucide-react";

export type InvoiceClientOption = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
};

export type InvoiceProjectOption = {
  id: string;
  projectName: string;
  clientId: string | null;
};

export type InvoicePaymentAccountOption = {
  id: string;
  title: string;
};

export function InvoiceForm({
  clients,
  projects,
  paymentAccounts,
  invoice,
}: {
  clients: InvoiceClientOption[];
  projects: InvoiceProjectOption[];
  paymentAccounts: InvoicePaymentAccountOption[];
  invoice?: InvoiceInput & { id: string; pdfOriginalName: string | null };
}) {
  const router = useRouter();
  const { track } = useActivity();
  const isEdit = !!invoice;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // How this invoice's document is produced. Existing invoices reopen in the
  // mode that matches whatever they already have.
  const [docMode, setDocMode] = useState<"generate" | "link" | "upload">(() => {
    if (invoice?.pdfExternalUrl) return "link";
    if (invoice?.pdfOriginalName) return "upload";
    return "generate";
  });

  const form = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      clientId: invoice?.clientId ?? "",
      projectId: invoice?.projectId ?? "none",
      amount: invoice?.amount ?? ("" as unknown as number),
      status: invoice?.status ?? "ASSIGNED",
      issueDate: invoice?.issueDate ?? new Date().toISOString().slice(0, 10),
      dueDate: invoice?.dueDate ?? "",
      notes: invoice?.notes ?? "",
      pdfExternalUrl: invoice?.pdfExternalUrl ?? "",
      title: invoice?.title ?? "",
      currency: invoice?.currency ?? "USD",
      paymentAccountId: invoice?.paymentAccountId ?? "none",
      items: invoice?.items?.length
        ? invoice.items
        : [{ description: "", qty: 1, rate: "" as unknown as number }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const selectedClient = form.watch("clientId");
  const clientProjects = projects.filter(
    (p) => p.clientId === selectedClient || p.clientId === null,
  );

  const watchedItems = form.watch("items");
  const currency = form.watch("currency");
  const currencySymbol = currency === "EUR" ? "€" : "$";
  const itemsTotal = (watchedItems ?? []).reduce((sum, i) => {
    const qty = typeof i?.qty === "number" && !Number.isNaN(i.qty) ? i.qty : 0;
    const rate = typeof i?.rate === "number" && !Number.isNaN(i.rate) ? i.rate : 0;
    return sum + qty * rate;
  }, 0);

  async function onSubmit(values: InvoiceInput) {
    const formData = new FormData();
    // Only the chosen document mode's data is submitted, so switching modes
    // clears the others rather than leaving a stale link/upload behind.
    const { items, ...scalars } = values;
    Object.entries(scalars).forEach(([key, value]) => {
      if (key === "pdfExternalUrl" && docMode !== "link") {
        formData.append(key, "");
        return;
      }
      formData.append(key, String(value ?? ""));
    });
    if (docMode === "generate" && items?.length) {
      formData.append("items", JSON.stringify(items));
    }
    const file = docMode === "upload" ? fileRef.current?.files?.[0] : undefined;
    if (file) formData.append("pdf", file);

    const label = file ? "Uploading invoice…" : "Saving…";
    if (isEdit) {
      const result = await track(updateInvoice(invoice.id, formData), label);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Invoice updated.");
      router.push(`/admin/invoices/${invoice.id}`);
      router.refresh();
    } else {
      const result = await track(createInvoice(formData), label);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Invoice created.");
      router.push(result.data ? `/admin/invoices/${result.data.id}` : "/admin/invoices");
      router.refresh();
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.firstName} {client.lastName}
                        {client.company ? ` — ${client.company}` : ""}
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
                      <SelectValue placeholder="Link a project" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {clientProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount (USD)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="450.00"
                    value={(field.value as number | string) ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? ("" as unknown as number) : Number(e.target.value),
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
            name="issueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Issue date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem className="sm:max-w-xs">
              <FormLabel>Status</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(invoiceStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* How the client gets their document: we build it, or you supply it. */}
        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium">Invoice document</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Generate a branded PDF from line items, or attach one you made
            yourself.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { value: "generate", label: "Generate PDF" },
                { value: "link", label: "Paste a link" },
                { value: "upload", label: "Upload PDF" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDocMode(opt.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  docMode === opt.value
                    ? "border-primary bg-brand-tint font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {docMode === "generate" && (
            <div className="mt-4 space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Monthly retainer invoice — June"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      The headline on the PDF. Defaults to the invoice number.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select value={field.value ?? "USD"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="USD">USD ($)</SelectItem>
                          <SelectItem value="EUR">EUR (€)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paymentAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment account on PDF</FormLabel>
                      <Select value={field.value || "none"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">No bank details</SelectItem>
                          {paymentAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        The one account whose details print at the bottom.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Line items</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ description: "", qty: 1, rate: "" as unknown as number })}
                  >
                    <Plus className="size-3.5" /> Add item
                  </Button>
                </div>

                <div className="space-y-2">
                  {fields.map((row, index) => (
                    <div key={row.id} className="flex items-start gap-2">
                      <FormField
                        control={form.control}
                        name={`items.${index}.description`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Textarea
                                rows={2}
                                placeholder={
                                  "Monthly Development & Design work\nZiener website :\nMegamenu development"
                                }
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.qty`}
                        render={({ field }) => (
                          <FormItem className="w-16">
                            <FormControl>
                              <Input
                                type="number"
                                min={0.01}
                                step="0.01"
                                placeholder="Qty"
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
                        name={`items.${index}.rate`}
                        render={({ field }) => (
                          <FormItem className="w-28">
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="Rate"
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 size-9 shrink-0 text-destructive hover:text-destructive"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove item</span>
                      </Button>
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  First line of a description is the bold title; lines ending in
                  &quot;:&quot; become group headings, the rest become bullets.
                </p>

                <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">
                    Total (replaces the amount above)
                  </span>
                  <span className="font-heading text-lg font-bold text-primary">
                    {currencySymbol}
                    {itemsTotal.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {docMode === "link" && (
            <FormField
              control={form.control}
              name="pdfExternalUrl"
              render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel className="flex items-center gap-1.5">
                    <Link2 className="size-3.5" />
                    Link an external file (Google Drive / Dropbox)
                  </FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://drive.google.com/…" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    The invoice&apos;s download button opens this directly.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {docMode === "upload" && (
          <div className="mt-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-brand-tint/40"
          >
            {fileName || invoice?.pdfOriginalName ? (
              <>
                <FileText className="size-4 shrink-0 text-primary" />
                <span className="truncate">
                  {fileName ?? invoice?.pdfOriginalName}
                  {!fileName && isEdit && " (current — choose a file to replace)"}
                </span>
              </>
            ) : (
              <>
                <Upload className="size-4 shrink-0" />
                Upload a PDF (max 25 MB)
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          </div>
          )}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Payment terms, bank details, references…"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {isEdit ? "Save changes" : "Create invoice"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
