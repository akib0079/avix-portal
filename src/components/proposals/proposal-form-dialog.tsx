"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  proposalSchema,
  proposalValidityDays,
  type ProposalInput,
} from "@/lib/validation/proposal";
import { createProposal, loadProposalBuilder, updateProposal } from "@/lib/actions/proposals";
import type { ProposalDraft } from "@/lib/dal/proposals";
import { projectTypeValues } from "@/lib/validation/project";
import { projectTypeLabels } from "@/lib/format";
import { CURRENCIES, formatCurrency, type CurrencyCode } from "@/lib/currency";
import { depositAmount } from "@/lib/proposal-rules";
import { cn } from "@/lib/utils";
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

export type ProposalLeadOption = {
  id: string;
  name: string;
  company: string | null;
  estimatedValue: number | null;
  brandInfo: string | null;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyInvoice = (currency: CurrencyCode = "USD") => ({
  title: "",
  currency,
  paymentAccountId: "none",
  invoiceNumber: "",
  issueDate: today(),
  dueDate: "",
  notes: "",
  billToCompany: "",
  billToAddress: "",
  billToEmail: "",
  items: [{ description: "", qty: 1, rate: "" as unknown as number }],
});

function valuesFromDraft(draft: ProposalDraft): ProposalInput {
  const inv = draft.invoice;
  return {
    source: draft.leadId ? "lead" : "manual",
    leadId: draft.leadId ?? "",
    recipientName: draft.recipientName ?? "",
    recipientEmail: draft.recipientEmail ?? "",
    recipientCompany: draft.recipientCompany ?? "",
    title: draft.title,
    intro: draft.intro ?? "",
    terms: draft.terms ?? "",
    currency: draft.currency,
    projectType: draft.projectType,
    timelineWeeks: draft.timelineWeeks,
    depositPercent: draft.depositPercent,
    expiresInDays: draft.expiresInDays,
    invoicePdfExternalUrl: draft.invoicePdfExternalUrl ?? "",
    removeInvoicePdf: false,
    items: draft.items.map((i) => ({ description: i.description, amount: i.amount })),
    invoice: inv
      ? {
          title: inv.title ?? "",
          currency: inv.currency,
          paymentAccountId: inv.paymentAccountId ?? "none",
          invoiceNumber: inv.invoiceNumber ?? "",
          issueDate: inv.issueDate,
          dueDate: inv.dueDate ?? "",
          notes: inv.notes ?? "",
          billToCompany: inv.billToCompany ?? "",
          billToAddress: inv.billToAddress ?? "",
          billToEmail: inv.billToEmail ?? "",
          items: inv.items.length ? inv.items : emptyInvoice(inv.currency).items,
        }
      : emptyInvoice(draft.currency),
  };
}

type Loaded = {
  /** Which opening this belongs to: the proposal id, or "new". */
  key: string;
  defaultTerms: string;
  paymentAccounts: { id: string; title: string }[];
  draft: ProposalDraft | null;
};

export function ProposalFormDialog({
  proposalId,
  leads,
  presetLeadId,
  open,
  onOpenChange,
}: {
  /** Edit this proposal; omit (or null) to build a new one. */
  proposalId?: string | null;
  leads: ProposalLeadOption[];
  /** When opened from the leads board, the lead is fixed up front. */
  presetLeadId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!proposalId;
  const [step, setStep] = useState<1 | 2>(1);
  const invoiceSeeded = useRef(false);
  // What the builder needs beyond the board's cards — the draft, the payment
  // accounts, the default terms — arrives when it opens.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadKey = proposalId ?? "new";
  const ready = !isEdit || loaded?.key === loadKey;
  const draft = loaded?.key === loadKey ? loaded.draft : null;

  const form = useForm<ProposalInput>({
    resolver: zodResolver(proposalSchema),
    defaultValues: {
      source: "lead",
      leadId: "",
      recipientName: "",
      recipientEmail: "",
      recipientCompany: "",
      title: "",
      intro: "",
      terms: "",
      currency: "USD",
      projectType: "CUSTOM_WEB_DEV",
      timelineWeeks: null,
      depositPercent: 50,
      expiresInDays: 30,
      invoicePdfExternalUrl: "",
      removeInvoicePdf: false,
      items: [{ description: "", amount: "" as unknown as number }],
      invoice: emptyInvoice(),
    },
  });

  // Invoice attachment: either a link or an uploaded PDF (never both at once).
  const [attachMode, setAttachMode] = useState<"none" | "link" | "upload">("none");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });
  const invoiceItems = useFieldArray({ control: form.control, name: "invoice.items" });

  /** Every opening loads afresh, so a cancelled edit never reappears. */
  function close() {
    setLoaded(null);
    onOpenChange(false);
  }

  useEffect(() => {
    if (!open) return;
    setStep(1);
    invoiceSeeded.current = false;
    setPdfFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!proposalId) {
      setAttachMode("none");
      // New proposal — seed from the lead so there's less typing.
      const lead = leads.find((l) => l.id === presetLeadId);
      form.reset({
        // Opened from a lead card → lead mode; opened cold with no leads to pick
        // from → go straight to manual so the form is never a dead end.
        source: presetLeadId || leads.length > 0 ? "lead" : "manual",
        leadId: presetLeadId ?? "",
        recipientName: "",
        recipientEmail: "",
        recipientCompany: "",
        title: lead?.company ? `${lead.company} — project` : "",
        intro: lead?.brandInfo ?? "",
        terms: "",
        currency: "USD",
        projectType: "CUSTOM_WEB_DEV",
        timelineWeeks: null,
        depositPercent: 50,
        expiresInDays: 30,
        invoicePdfExternalUrl: "",
        removeInvoicePdf: false,
        items: [
          {
            description: "Project scope",
            amount: (lead?.estimatedValue ?? "") as unknown as number,
          },
        ],
        invoice: emptyInvoice(),
      });
    }

    let live = true;
    const key = proposalId ?? "new";
    loadProposalBuilder(proposalId ?? null).then(
      (result) => {
        if (!live) return;
        if (!result.ok) {
          toast.error(result.error);
          close();
          return;
        }
        const data = result.data!;
        setLoaded({ key, ...data });
        if (data.draft) {
          setAttachMode(
            data.draft.invoicePdfPath ? "upload" : data.draft.invoicePdfExternalUrl ? "link" : "none",
          );
          form.reset(valuesFromDraft(data.draft));
          // An existing proposal already has its invoice — don't re-seed from scope.
          invoiceSeeded.current = true;
        } else if (!form.getFieldState("terms").isDirty) {
          // Starts from the agency's default terms, still editable here.
          form.setValue("terms", data.defaultTerms);
        }
      },
      () => {
        if (!live) return;
        toast.error("Couldn't load the proposal builder. Try again.");
        close();
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposalId, presetLeadId]);

  const source = form.watch("source");
  const currency = form.watch("currency");
  const items = form.watch("items");
  const depositPercent = form.watch("depositPercent");
  const total = (items ?? []).reduce(
    (sum, i) => sum + (typeof i.amount === "number" && !Number.isNaN(i.amount) ? i.amount : 0),
    0,
  );
  const deposit = depositAmount(total, depositPercent || 0);

  const invoiceCurrency = form.watch("invoice.currency");
  const invItems = form.watch("invoice.items");
  const invoiceTotal = (invItems ?? []).reduce((sum, i) => {
    const qty = typeof i.qty === "number" && !Number.isNaN(i.qty) ? i.qty : 0;
    const rate = typeof i.rate === "number" && !Number.isNaN(i.rate) ? i.rate : 0;
    return sum + qty * rate;
  }, 0);
  const paymentAccounts = loaded?.paymentAccounts ?? [];

  /** The proposal's lines as invoice lines (rate = line amount). */
  function scopeLines() {
    return (form.getValues("items") ?? [])
      .filter((s) => (s.description ?? "").trim() || Number(s.amount) > 0)
      .map((s) => ({
        description: s.description || "Project scope",
        qty: 1,
        rate: (typeof s.amount === "number" && !Number.isNaN(s.amount) ? s.amount : 0) as number,
      }));
  }

  // Step 1 → 2: validate the proposal fields, then seed the invoice lines from
  // the scope the first time (so the invoice starts pre-filled, still editable).
  async function goToInvoice() {
    const ok = await form.trigger([
      "source",
      "leadId",
      "recipientName",
      "recipientEmail",
      "title",
      "projectType",
      "currency",
      "terms",
      "items",
    ]);
    if (!ok) return;
    if (!invoiceSeeded.current) {
      const seeded = scopeLines();
      if (seeded.length) invoiceItems.replace(seeded);
      const title = form.getValues("title");
      if (title) form.setValue("invoice.title", title);
      form.setValue("invoice.currency", form.getValues("currency"));
      invoiceSeeded.current = true;
    }
    setStep(2);
  }

  async function onSubmit(values: ProposalInput) {
    // Only one attachment kind survives, so switching modes clears the other.
    const payload: ProposalInput = {
      ...values,
      invoicePdfExternalUrl: attachMode === "link" ? values.invoicePdfExternalUrl : "",
      removeInvoicePdf: attachMode !== "upload",
    };

    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    if (attachMode === "upload" && pdfFile) fd.set("pdf", pdfFile);

    // Both actions revalidate the pages that list proposals, which redraws
    // whichever one this dialog was opened from.
    if (proposalId) {
      const result = await updateProposal(proposalId, fd);
      if (!result.ok) return void toast.error(result.error);
      const locked = result.data?.invoiceLocked;
      if (locked) {
        toast.success("Proposal updated.", {
          description: `Invoice ${locked.invoiceNumber} wasn't changed: ${locked.reason}. Edit it from the invoice page.`,
        });
      } else {
        toast.success("Proposal updated.");
      }
    } else {
      const result = await createProposal(fd);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Proposal created.");
    }
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit proposal" : "New proposal"}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · Step {step} of 2 — {step === 1 ? "Proposal" : "Invoice"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Build the scope and price. Creating the proposal sets up the client account and a draft invoice automatically."
              : "Build the client's first invoice — the proposal shows them this total, and it stays a draft until they accept."}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the proposal…
          </div>
        ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className={cn("space-y-4", step !== 1 && "hidden")}>
            {/* Where the recipient comes from */}
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposal for</FormLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {(
                      [
                        { value: "lead", label: "A lead in my pipeline" },
                        { value: "manual", label: "Someone else (enter manually)" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={opt.value === "lead" && leads.length === 0}
                        onClick={() => field.onChange(opt.value)}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          field.value === opt.value
                            ? "border-primary bg-brand-tint font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {source === "manual" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="recipientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Their name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Nadia Rahman" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recipientEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Their email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="nadia@verdant.co" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recipientCompany"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Verdant Skincare" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {source === "lead" && (
              <FormField
                control={form.control}
                name="leadId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select lead" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {leads.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                            {l.company ? ` — ${l.company}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="projectType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projectTypeValues.map((t) => (
                          <SelectItem key={t} value={t}>
                            {projectTypeLabels[t]}
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
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(next) => {
                        // The invoice follows the proposal's currency unless
                        // it was deliberately set to another one.
                        if (form.getValues("invoice.currency") === field.value) {
                          form.setValue("invoice.currency", next as CurrencyCode);
                        }
                        field.onChange(next);
                      }}
                    >
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
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposal title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Website rebuild" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="intro"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Intro (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="A short pitch — what you understood about their business and how you'd approach it…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Line items */}
            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Scope &amp; pricing</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ description: "", amount: "" as unknown as number })}
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
                        <FormItem className="min-w-0 flex-1">
                          <FormControl>
                            <Input placeholder="e.g. Design (6 pages)" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.amount`}
                      render={({ field }) => (
                        <FormItem className="w-28 sm:w-32">
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              placeholder="0.00"
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

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  Deposit ({depositPercent || 0}%):{" "}
                  <span className="font-medium text-foreground">{formatCurrency(deposit, currency)}</span>
                </span>
                <span className="font-heading text-lg font-bold text-primary">
                  {formatCurrency(total, currency)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="timelineWeeks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timeline (weeks)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={104}
                        placeholder="6"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="depositPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deposit %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? 0 : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiresInDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid for (days)</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[...new Set([...proposalValidityDays, field.value])]
                          .sort((a, b) => a - b)
                          .map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {d} days
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="terms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terms</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      placeholder="Payment terms, ownership, revisions, cancellation…"
                      className="text-sm"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Shown to the client under the scope. New proposals start from the default
                    terms in Settings.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Invoice document — carried onto the first invoice */}
            <div className="rounded-xl border p-3">
              <p className="text-sm font-medium">Invoice document (optional)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Attach the invoice now and it&apos;s added to the client&apos;s first invoice.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    { value: "none", label: "None" },
                    { value: "link", label: "Paste a link" },
                    { value: "upload", label: "Upload PDF" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAttachMode(opt.value)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      attachMode === opt.value
                        ? "border-primary bg-brand-tint font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {attachMode === "link" && (
                <FormField
                  control={form.control}
                  name="invoicePdfExternalUrl"
                  render={({ field }) => (
                    <FormItem className="mt-3">
                      <FormLabel>Invoice link</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://drive.google.com/… or Dropbox link"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {attachMode === "upload" && (
                <div className="mt-3">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {pdfFile
                      ? `Selected: ${pdfFile.name}`
                      : draft?.invoicePdfOriginalName
                        ? `Currently attached: ${draft.invoicePdfOriginalName} — choose a file to replace it.`
                        : "PDF only, up to 25 MB."}
                  </p>
                </div>
              )}
            </div>
            </div>

            {/* Step 2 — the client's first invoice */}
            <div className={cn("space-y-4", step !== 2 && "hidden")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="invoice.currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
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
                  name="invoice.paymentAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment account</FormLabel>
                      <Select value={field.value || "none"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {paymentAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.title}
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
                  name="invoice.invoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice no. (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Auto" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="invoice.issueDate"
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
                  name="invoice.dueDate"
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

              {/* Invoice line items (qty × rate) */}
              <div className="rounded-xl border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Invoice items</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      invoiceItems.append({ description: "", qty: 1, rate: "" as unknown as number })
                    }
                  >
                    <Plus className="size-3.5" /> Add line
                  </Button>
                </div>
                {/* What to bill first is a choice; these set the lines in one go. */}
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Start from:</span>
                  {deposit > 0 && depositPercent < 100 && (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() =>
                        invoiceItems.replace([
                          {
                            description: `${form.getValues("title") || "Project"} — ${depositPercent}% deposit`,
                            qty: 1,
                            rate: deposit,
                          },
                        ])
                      }
                    >
                      the {depositPercent}% deposit ({formatCurrency(deposit, currency)})
                    </button>
                  )}
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => {
                      const lines = scopeLines();
                      if (lines.length) invoiceItems.replace(lines);
                    }}
                  >
                    the full scope ({formatCurrency(total, currency)})
                  </button>
                </div>
                <div className="space-y-2">
                  {invoiceItems.fields.map((row, index) => (
                    <div key={row.id} className="flex items-start gap-2">
                      <FormField
                        control={form.control}
                        name={`invoice.items.${index}.description`}
                        render={({ field }) => (
                          <FormItem className="min-w-0 flex-1">
                            <FormControl>
                              <Input placeholder="e.g. Website build" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`invoice.items.${index}.qty`}
                        render={({ field }) => (
                          <FormItem className="w-16">
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                step="1"
                                placeholder="Qty"
                                value={(field.value as number | string) ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value === "" ? 0 : Number(e.target.value))
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`invoice.items.${index}.rate`}
                        render={({ field }) => (
                          <FormItem className="w-24 sm:w-28">
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="Rate"
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 size-9 shrink-0 text-destructive hover:text-destructive"
                        disabled={invoiceItems.fields.length === 1}
                        onClick={() => invoiceItems.remove(index)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove line</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">
                    Invoice total
                    <span className="block text-xs">The client sees this as their first invoice.</span>
                  </span>
                  <span className="font-heading text-lg font-bold text-primary">
                    {formatCurrency(invoiceTotal, invoiceCurrency)}
                  </span>
                </div>
              </div>

              {/* Billed-to overrides */}
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-sm font-medium">Billed to (optional)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="invoice.billToCompany"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company name</FormLabel>
                        <FormControl>
                          <Input placeholder="Client company" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="invoice.billToEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="billing@client.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="invoice.billToAddress"
                  render={({ field }) => (
                    <FormItem className="mt-3">
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="Street, city, country" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="invoice.notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Shown on the invoice." {...field} />
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
                onClick={close}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              {step === 1 ? (
                <Button type="button" onClick={goToInvoice}>
                  Next: invoice →
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    ← Back
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                    {isEdit ? "Save changes" : "Create proposal"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
