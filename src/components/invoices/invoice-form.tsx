"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
import { Loader2, FileText, Upload, Link2 } from "lucide-react";

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

export function InvoiceForm({
  clients,
  projects,
  invoice,
}: {
  clients: InvoiceClientOption[];
  projects: InvoiceProjectOption[];
  invoice?: InvoiceInput & { id: string; pdfOriginalName: string | null };
}) {
  const router = useRouter();
  const isEdit = !!invoice;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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
    },
  });

  const selectedClient = form.watch("clientId");
  const clientProjects = projects.filter(
    (p) => p.clientId === selectedClient || p.clientId === null,
  );

  async function onSubmit(values: InvoiceInput) {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      formData.append(key, String(value ?? ""));
    });
    const file = fileRef.current?.files?.[0];
    if (file) formData.append("pdf", file);

    if (isEdit) {
      const result = await updateInvoice(invoice.id, formData);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Invoice updated.");
      router.push(`/admin/invoices/${invoice.id}`);
      router.refresh();
    } else {
      const result = await createInvoice(formData);
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

        <div>
          <p className="mb-2 text-sm font-medium">Invoice PDF</p>
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
          <FormField
            control={form.control}
            name="pdfExternalUrl"
            render={({ field }) => (
              <FormItem className="mt-3">
                <FormLabel className="flex items-center gap-1.5 font-normal text-muted-foreground">
                  <Link2 className="size-3.5" />
                  …or link an external file (Google Drive / Dropbox)
                </FormLabel>
                <FormControl>
                  <Input
                    type="url"
                    placeholder="https://drive.google.com/…"
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  When a link is set, the invoice&apos;s download button opens it
                  directly (takes priority over an uploaded PDF).
                </p>
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
