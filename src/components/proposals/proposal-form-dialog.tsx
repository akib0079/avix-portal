"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { proposalSchema, type ProposalInput } from "@/lib/validation/proposal";
import { createProposal, updateProposal } from "@/lib/actions/proposals";
import type { ProposalView } from "@/lib/dal/proposals";
import { projectTypeValues } from "@/lib/validation/project";
import { projectTypeLabels, usd } from "@/lib/format";
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

export function ProposalFormDialog({
  proposal,
  leads,
  presetLeadId,
  open,
  onOpenChange,
}: {
  proposal?: ProposalView | null;
  leads: ProposalLeadOption[];
  /** When opened from the leads board, the lead is fixed up front. */
  presetLeadId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = !!proposal;

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
      projectType: "CUSTOM_WEB_DEV",
      timelineWeeks: null,
      depositPercent: 50,
      expiresInDays: 30,
      invoicePdfExternalUrl: "",
      removeInvoicePdf: false,
      items: [{ description: "", amount: "" as unknown as number }],
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

  useEffect(() => {
    if (!open) return;
    setPdfFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (proposal) {
      setAttachMode(
        proposal.invoicePdfPath ? "upload" : proposal.invoicePdfExternalUrl ? "link" : "none",
      );
      form.reset({
        source: proposal.leadId ? "lead" : "manual",
        leadId: proposal.leadId ?? "",
        recipientName: proposal.recipientName ?? "",
        recipientEmail: proposal.recipientEmail ?? "",
        recipientCompany: proposal.recipientCompany ?? "",
        title: proposal.title,
        intro: proposal.intro ?? "",
        projectType: proposal.projectType,
        timelineWeeks: proposal.timelineWeeks,
        depositPercent: proposal.depositPercent,
        expiresInDays: proposal.expiresInDays,
        invoicePdfExternalUrl: proposal.invoicePdfExternalUrl ?? "",
        removeInvoicePdf: false,
        items: proposal.items.map((i) => ({ description: i.description, amount: i.amount })),
      });
      return;
    }
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposal?.id, presetLeadId]);

  const source = form.watch("source");
  const items = form.watch("items");
  const depositPercent = form.watch("depositPercent");
  const total = (items ?? []).reduce(
    (sum, i) => sum + (typeof i.amount === "number" && !Number.isNaN(i.amount) ? i.amount : 0),
    0,
  );
  const deposit = Math.round(total * (depositPercent || 0)) / 100;

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

    const result = isEdit
      ? await updateProposal(proposal.id, fd)
      : await createProposal(fd);
    if (!result.ok) return void toast.error(result.error);
    toast.success(isEdit ? "Proposal updated." : "Proposal created.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit proposal" : "New proposal"}
          </DialogTitle>
          <DialogDescription>
            Build the scope and price. When you send it, the prospect gets a link
            to accept online — which creates their account, project and deposit
            invoice automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Where the recipient comes from */}
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposal for</FormLabel>
                  <div className="flex gap-2">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {source === "lead" && (
                <FormField
                  control={form.control}
                  name="leadId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isEdit}
                      >
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
                        <FormItem className="flex-1">
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
                        <FormItem className="w-32">
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

              <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  Deposit ({depositPercent || 0}%):{" "}
                  <span className="font-medium text-foreground">{usd.format(deposit)}</span>
                </span>
                <span className="font-heading text-lg font-bold text-primary">
                  {usd.format(total)}
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
                        {[7, 14, 30, 60, 90].map((d) => (
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

            {/* Invoice document — carried onto the deposit invoice on acceptance */}
            <div className="rounded-xl border p-3">
              <p className="text-sm font-medium">Invoice document (optional)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Attach the invoice now and it&apos;s added to the deposit invoice
                created when they accept.
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
                      : proposal?.invoicePdfOriginalName
                        ? `Currently attached: ${proposal.invoicePdfOriginalName} — choose a file to replace it.`
                        : "PDF only, up to 25 MB."}
                  </p>
                </div>
              )}
            </div>

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
                {isEdit ? "Save changes" : "Create proposal"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
