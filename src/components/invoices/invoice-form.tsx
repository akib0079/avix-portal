"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  invoiceSchema,
  paymentTermsOptions,
  type InvoiceInput,
} from "@/lib/validation/invoice";
import { invoiceTotals, dueDateFromTerms } from "@/lib/invoice-totals";
import { CURRENCIES, currencySymbol as symbolFor } from "@/lib/currency";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { richTextToLines, linesToRichDoc } from "@/lib/rich-text";
import type { JSONContent } from "@tiptap/react";
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
      discount: invoice?.discount ?? 0,
      taxRate: invoice?.taxRate ?? null,
      taxLabel: invoice?.taxLabel ?? "",
      paymentTermsDays: invoice?.paymentTermsDays ?? null,
      notes: invoice?.notes ?? "",
      pdfExternalUrl: invoice?.pdfExternalUrl ?? "",
      invoiceNumber: invoice?.invoiceNumber ?? "",
      title: invoice?.title ?? "",
      currency: invoice?.currency ?? "USD",
      amountUsd: invoice?.amountUsd ?? null,
      paymentAccountId: invoice?.paymentAccountId ?? "none",
      billToCompany: invoice?.billToCompany ?? "",
      billToAddress: invoice?.billToAddress ?? "",
      billToEmail: invoice?.billToEmail ?? "",
      items: invoice?.items?.length
        ? invoice.items
        : [{ description: "", descriptionRich: null, qty: 1, rate: "" as unknown as number }],
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
  const currencySymbol = symbolFor(currency);
  const watchedDiscount = form.watch("discount");
  const watchedTaxRate = form.watch("taxRate");
  const watchedTaxLabel = form.watch("taxLabel");
  const watchedAmount = form.watch("amount");
  const watchedIssueDate = form.watch("issueDate");
  const watchedTerms = form.watch("paymentTermsDays");

  // Same helper the server and the PDF use, so the number on screen is the
  // number that gets stored.
  const totals = invoiceTotals({
    items: (watchedItems ?? []).map((i) => ({
      qty: typeof i?.qty === "number" && !Number.isNaN(i.qty) ? i.qty : 0,
      rate: typeof i?.rate === "number" && !Number.isNaN(i.rate) ? i.rate : 0,
    })),
    amount: typeof watchedAmount === "number" ? watchedAmount : 0,
    discount: typeof watchedDiscount === "number" ? watchedDiscount : 0,
    taxRate: typeof watchedTaxRate === "number" ? watchedTaxRate : null,
  });
  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // Net terms drive the due date; picking terms fills the date field in.
  function applyTerms(days: number | null) {
    form.setValue("paymentTermsDays", days);
    const derived = dueDateFromTerms(watchedIssueDate, days);
    if (derived) form.setValue("dueDate", derived);
  }

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
      // descriptionRich is the source of truth; the plain text is derived here
      // rather than trusted from form state, so what is stored can never drift
      // from what was typed even if a field failed to register.
      const withPlain = items.map((item) => ({
        ...item,
        description: item.descriptionRich
          ? richTextToLines(item.descriptionRich)
          : item.description,
      }));
      formData.append("items", JSON.stringify(withPlain));
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
                <FormLabel>Amount ({currency})</FormLabel>
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
          {/* Only for currencies that are not already USD. Hand-entered
              because the rate that counts is the one the payment settles at,
              which no live feed knows at invoicing time. */}
          {currency !== "USD" && (
            <FormField
              control={form.control}
              name="amountUsd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Value in USD</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="What lands in your account"
                      value={(field.value as number | string | null) ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Billed to the client as {currencySymbol}
                    {(Number(watchedAmount) || 0).toLocaleString("en-US")}. This is the
                    figure your reports count — leave it blank and the invoice stays
                    outside your totals.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
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
          <FormItem>
            <FormLabel>Payment terms</FormLabel>
            <Select
              value={watchedTerms == null ? "none" : String(watchedTerms)}
              onValueChange={(v) => applyTerms(v === "none" ? null : Number(v))}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No terms" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">No terms</SelectItem>
                {paymentTermsOptions.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days === 0 ? "Due on receipt" : `Net ${days}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
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

              <FormField
                control={form.control}
                name="invoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice number (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Auto — e.g. INV-012 or 2026-001" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Leave blank to auto-assign the next number.
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

              {/* Billed-to overrides — the PDF falls back to the client record. */}
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Billed to (optional)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="billToCompany"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Defaults to the client's company"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="billToEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="accounts@client.com"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="billToAddress"
                  render={({ field }) => (
                    <FormItem className="mt-3">
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder="Street, city, postal code, country"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
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
                    onClick={() =>
                      append({
                        description: "",
                        descriptionRich: null,
                        qty: 1,
                        rate: "" as unknown as number,
                      })
                    }
                  >
                    <Plus className="size-3.5" /> Add item
                  </Button>
                </div>

                <div className="space-y-2">
                  {fields.map((row, index) => (
                    <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <FormField
                        control={form.control}
                        name={`items.${index}.descriptionRich`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              {/* A line item is a small document — a title and
                                  what it covered — so it gets a real editor
                                  rather than a convention about colons. The
                                  plain projection is written alongside it on
                                  every keystroke, because the PDF fallback,
                                  emails and search all read that. */}
                              <RichTextEditor
                                // Older invoices have no rich document — their
                                // words live in `description`. Seeding from
                                // that is why an existing invoice no longer
                                // opens with an empty editor, and it migrates
                                // the item to real formatting on the next save.
                                value={
                                  (field.value as JSONContent | null) ??
                                  (linesToRichDoc(
                                    form.getValues(`items.${index}.description`) ?? "",
                                  ) as JSONContent | null)
                                }
                                onChange={(json) => {
                                  // field.onChange registers the path with the
                                  // form; setValue alone did not survive the
                                  // field array's reconciliation.
                                  field.onChange(json);
                                  // The plain projection keeps its line breaks
                                  // so the PDF fallback and emails can still
                                  // read the structure back.
                                  form.setValue(
                                    `items.${index}.description`,
                                    richTextToLines(json),
                                    { shouldDirty: true, shouldValidate: true },
                                  );
                                }}
                                placeholder="Website redesign — what it covered…"
                                allowImages={false}
                                compact
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {/* Below sm these sit on their own row. In one line the
                          description gets ~51px on a 375px screen, which is
                          the invoice's main field reduced to a slit.
                          `sm:contents` dissolves this wrapper above sm so the
                          original single-row layout is untouched. */}
                      <div className="flex items-start gap-2 sm:contents">
                        <FormField
                          control={form.control}
                          name={`items.${index}.qty`}
                          render={({ field }) => (
                            <FormItem className="flex-1 sm:w-16 sm:flex-none">
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
                            <FormItem className="flex-1 sm:w-28 sm:flex-none">
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
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  Bold, italics, bullets and numbered lists all carry through to the
                  PDF exactly as you write them here.
                </p>

                {/* Discount and tax live with the lines they modify. */}
                <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="discount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Discount</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? 0 : Number(e.target.value),
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
                    name="taxLabel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Tax label</FormLabel>
                        <FormControl>
                          <Input placeholder="VAT / AIT / GST" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Tax %</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            placeholder="0"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? null : Number(e.target.value),
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="mt-3 space-y-1 border-t pt-3 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{money(totals.subtotal)}</span>
                  </div>
                  {totals.discount > 0 && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>−{money(totals.discount)}</span>
                    </div>
                  )}
                  {totals.taxAmount > 0 && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>
                        {watchedTaxLabel || "Tax"} ({watchedTaxRate}%)
                      </span>
                      <span>{money(totals.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t pt-2">
                    <span className="text-muted-foreground">
                      Total (replaces the amount above)
                    </span>
                    <span className="font-heading text-lg font-bold text-primary">
                      {money(totals.total)}
                    </span>
                  </div>
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
