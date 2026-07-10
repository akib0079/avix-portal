"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import { campaignSchema, type CampaignInput } from "@/lib/validation/marketing";
import { sendCampaign } from "@/lib/actions/marketing";
import type { TemplateView } from "./template-manager";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { Loader2, Send, Eye, EyeOff, TriangleAlert, Check } from "lucide-react";

export type RecipientOption = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
};

const TIMEOUT_WARN_COUNT = 40;

export function CampaignComposer({
  templates,
  recipients,
  initialTemplateId,
}: {
  templates: TemplateView[];
  recipients: RecipientOption[];
  initialTemplateId?: string;
}) {
  const router = useRouter();
  const initialTemplate = templates.find((t) => t.id === initialTemplateId);
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const form = useForm<CampaignInput>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      subject: initialTemplate?.subject ?? "",
      body: initialTemplate?.body ?? undefined,
      templateId: initialTemplate?.id ?? "",
      recipientIds: [],
    },
  });

  const selectedIds = form.watch("recipientIds");
  const body = form.watch("body");
  const allSelected =
    recipients.length > 0 && selectedIds.length === recipients.length;

  function applyTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    form.setValue("templateId", id === "none" ? "" : id);
    if (template) {
      form.setValue("subject", template.subject, { shouldValidate: true });
      form.setValue("body", template.body, { shouldValidate: true });
    }
  }

  function toggleRecipient(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((r) => r !== id)
      : [...selectedIds, id];
    form.setValue("recipientIds", next, { shouldValidate: true });
  }

  const selectedRecipients = useMemo(
    () => recipients.filter((r) => selectedIds.includes(r.id)),
    [recipients, selectedIds],
  );

  async function doSend() {
    setSending(true);
    const result = await sendCampaign(form.getValues());
    setSending(false);
    setConfirming(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Campaign sent.");
    router.push(result.data ? `/admin/marketing/${result.data.id}` : "/admin/marketing");
    router.refresh();
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => setConfirming(true))}
        className="space-y-6"
      >
        <Card>
          <CardContent className="space-y-5 pt-6">
            {templates.length > 0 && (
              <FormItem>
                <FormLabel>Start from a template (optional)</FormLabel>
                <Select
                  value={form.watch("templateId") || "none"}
                  onValueChange={applyTemplate}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Write from scratch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Write from scratch</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. New offer from Avix Digital" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Email content</FormLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPreview((v) => !v)}
                      disabled={!hasRichTextContent(body)}
                    >
                      {showPreview ? <EyeOff /> : <Eye />}
                      {showPreview ? "Hide preview" : "Preview"}
                    </Button>
                  </div>
                  <FormControl>
                    <RichTextEditor
                      value={(field.value as JSONContent) ?? null}
                      onChange={field.onChange}
                      placeholder="Write the offer or update you want to share…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showPreview && hasRichTextContent(body) && (
              <div className="rounded-xl border bg-slate-50 p-4">
                <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Email preview
                </p>
                <div className="mx-auto max-w-lg overflow-hidden rounded-xl border bg-white shadow-sm">
                  <div className="bg-[#0F172A] px-6 py-4">
                    <span className="font-heading text-sm font-bold text-white">
                      Avix<span className="text-[#F65D0B]">.</span> Digital
                    </span>
                  </div>
                  <div className="px-6 py-5">
                    <p className="mb-3 text-sm font-semibold">
                      {form.watch("subject") || "(no subject)"}
                    </p>
                    <RichTextViewer content={body} />
                    <p className="mt-5 border-t pt-3 text-[11px] text-slate-400">
                      Unsubscribe from marketing emails — project and invoice
                      emails are unaffected.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <FormField
              control={form.control}
              name="recipientIds"
              render={() => (
                <FormItem>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <FormLabel className="text-base">
                        Recipients{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          ({selectedIds.length} of {recipients.length})
                        </span>
                      </FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Active clients who haven&apos;t unsubscribed from marketing.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        form.setValue(
                          "recipientIds",
                          allSelected ? [] : recipients.map((r) => r.id),
                          { shouldValidate: true },
                        )
                      }
                      disabled={recipients.length === 0}
                    >
                      {allSelected ? "Clear all" : "Select all"}
                    </Button>
                  </div>

                  {recipients.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                      No eligible clients — add active clients first.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {recipients.map((r) => {
                        const checked = selectedIds.includes(r.id);
                        return (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => toggleRecipient(r.id)}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                              checked
                                ? "border-primary/40 bg-brand-tint"
                                : "hover:bg-muted/50",
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded border",
                                checked
                                  ? "border-primary bg-primary text-white"
                                  : "border-slate-300 bg-white",
                              )}
                            >
                              {checked && <Check className="size-3.5" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {r.firstName} {r.lastName}
                                {r.company ? ` — ${r.company}` : ""}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {r.email}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedIds.length > TIMEOUT_WARN_COUNT && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Large send — emails go out one by one, so this may take a while.
                If it stops partway, open the campaign afterwards and use
                “Retry failed”.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={sending}>
            <Send /> Review &amp; send
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={sending}
          >
            Cancel
          </Button>
        </div>
      </form>

      <Dialog open={confirming} onOpenChange={(open) => !sending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to {selectedRecipients.length} client{selectedRecipients.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              “{form.watch("subject")}” will be emailed immediately. Each email
              includes an unsubscribe link.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-lg border p-3 text-sm">
            {selectedRecipients.map((r) => (
              <p key={r.id} className="truncate text-muted-foreground">
                {r.firstName} {r.lastName} · {r.email}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending}>
              Back
            </Button>
            <Button onClick={doSend} disabled={sending}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? "Sending…" : "Send campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
