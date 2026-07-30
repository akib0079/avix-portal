"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import { campaignSchema, type CampaignInput } from "@/lib/validation/marketing";
import {
  sendCampaign,
  saveCampaignDraft,
  updateCampaign,
  queueCampaign,
  scheduleCampaign,
  sendTestCampaign,
} from "@/lib/actions/marketing";
import type { TemplateView } from "./template-manager";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
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
import { useActivity } from "@/components/layout/activity-indicator";
import { mergeTags } from "@/lib/merge-tags";
import { AudiencePicker, type SegmentOption } from "@/components/marketing/audience-picker";
import type { AudienceEntry } from "@/lib/dal/marketing";
import {
  Loader2,
  Send,
  Eye,
  EyeOff,
  TriangleAlert,
  Save,
  Clock,
  MailCheck,
} from "lucide-react";

const TIMEOUT_WARN_COUNT = 40;

/** Existing DRAFT / SCHEDULED campaign being edited, if any. */
export type CampaignDraft = {
  id: string;
  subject: string;
  body: JSONContent | null;
  templateId: string | null;
  recipientIds: string[];
};

export function CampaignComposer({
  templates,
  audience,
  segments,
  initialTemplateId,
  draft,
}: {
  templates: TemplateView[];
  audience: AudienceEntry[];
  segments: SegmentOption[];
  initialTemplateId?: string;
  draft?: CampaignDraft;
}) {
  const router = useRouter();
  const { track } = useActivity();
  const initialTemplate = templates.find((t) => t.id === initialTemplateId);
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const form = useForm<CampaignInput>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      subject: draft?.subject ?? initialTemplate?.subject ?? "",
      body: draft?.body ?? initialTemplate?.body ?? undefined,
      templateId: draft?.templateId ?? initialTemplate?.id ?? "",
      recipientIds: draft?.recipientIds ?? [],
    },
  });

  const selectedIds = form.watch("recipientIds");
  const body = form.watch("body");

  function applyTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    form.setValue("templateId", id === "none" ? "" : id);
    if (template) {
      form.setValue("subject", template.subject, { shouldValidate: true });
      form.setValue("body", template.body, { shouldValidate: true });
    }
  }

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  /** Ask the server to render the real CampaignEmail for the preview pane. */
  async function togglePreview() {
    if (showPreview) return setShowPreview(false);
    setShowPreview(true);
    setPreviewHtml(null);
    try {
      const res = await fetch("/admin/marketing/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: form.getValues("subject"), body: form.getValues("body") }),
      });
      if (!res.ok) throw new Error("preview failed");
      setPreviewHtml(await res.text());
    } catch {
      setShowPreview(false);
      toast.error("Couldn't render the preview.");
    }
  }

  async function doTestSend() {
    setSending(true);
    const res = await track(sendTestCampaign(form.getValues()), "Sending test…");
    setSending(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Test sent to your own inbox.");
  }

  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  const selectedRecipients = useMemo(
    () => audience.filter((r) => selectedIds.includes(r.key)),
    [audience, selectedIds],
  );

  /**
   * Save whatever is in the form — updating the draft being edited, or creating
   * a new one — and hand back the campaign id for the caller to act on.
   */
  async function persistDraft(label: string): Promise<string | null> {
    const values = form.getValues();
    if (draft) {
      const res = await track(updateCampaign(draft.id, values), label);
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      return draft.id;
    }
    const res = await track(saveCampaignDraft(values), label);
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Couldn't save the campaign." : res.error);
      return null;
    }
    return res.data.id;
  }

  async function doSend() {
    setSending(true);
    // Editing an existing draft: save it, then queue. New campaign: one call.
    if (draft) {
      const id = await persistDraft("Queueing campaign…");
      if (!id) {
        setSending(false);
        return;
      }
      const queued = await queueCampaign(id);
      setSending(false);
      setConfirming(false);
      if (!queued.ok) return void toast.error(queued.error);
      toast.success("Campaign queued — it starts sending in the background.");
      router.push(`/admin/marketing/${id}`);
      router.refresh();
      return;
    }
    const result = await track(sendCampaign(form.getValues()), "Queueing campaign…");
    setSending(false);
    setConfirming(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Campaign queued — it starts sending in the background.");
    router.push(result.data ? `/admin/marketing/${result.data.id}` : "/admin/marketing");
    router.refresh();
  }

  async function doSaveDraft() {
    if (!form.getValues().subject?.trim()) return void toast.error("Add a subject first.");
    setSending(true);
    const id = await persistDraft("Saving draft…");
    setSending(false);
    if (!id) return;
    toast.success("Draft saved.");
    router.push(`/admin/marketing/${id}`);
    router.refresh();
  }

  async function doSchedule() {
    if (!form.getValues().subject?.trim()) return void toast.error("Add a subject first.");
    if (!scheduleAt) return void toast.error("Pick a date and time.");
    setSending(true);
    const id = await persistDraft("Scheduling…");
    if (!id) {
      setSending(false);
      return;
    }
    const result = await scheduleCampaign(id, new Date(scheduleAt).toISOString());
    setSending(false);
    setScheduling(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Scheduled.");
    router.push(`/admin/marketing/${id}`);
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
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <FormLabel>Email content</FormLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={togglePreview}
                      disabled={!hasRichTextContent(body)}
                    >
                      {showPreview ? <EyeOff /> : <Eye />}
                      {showPreview ? "Hide preview" : "Preview"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={doTestSend}
                      disabled={sending || !hasRichTextContent(body)}
                    >
                      <MailCheck /> Send test to me
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

            <p className="text-xs text-muted-foreground">
              Personalise with{" "}
              {mergeTags.map((t, i) => (
                <span key={t.tag}>
                  {i > 0 && ", "}
                  <code className="rounded bg-muted px-1 py-0.5">{t.tag}</code>
                </span>
              ))}
              . Missing values fall back (&ldquo;Hi there&rdquo;), never blank.
            </p>

            {showPreview && (
              <div className="rounded-xl border bg-muted p-4">
                <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Email preview — the real template, with sample merge values
                </p>
                {previewHtml === null ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline size-4 animate-spin" />
                    Rendering…
                  </p>
                ) : (
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="h-[520px] w-full rounded-xl border bg-white"
                  />
                )}
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
                  <AudiencePicker
                    audience={audience}
                    segments={segments}
                    value={selectedIds}
                    onChange={(next) =>
                      form.setValue("recipientIds", next, { shouldValidate: true })
                    }
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedIds.length > TIMEOUT_WARN_COUNT && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Large send — it runs in the background in batches, so you can
                close this page. Progress shows on the campaign afterwards.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={sending}>
            <Send /> Review &amp; send
          </Button>
          <Button type="button" variant="outline" onClick={doSaveDraft} disabled={sending}>
            <Save /> Save draft
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setScheduling(true)}
            disabled={sending}
          >
            <Clock /> Schedule
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
            <DialogTitle>
              Send to {selectedRecipients.length} recipient
              {selectedRecipients.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              “{form.watch("subject")}” gets queued and sends in the background,
              so you can close this page. Each email includes an unsubscribe link.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-lg border p-3 text-sm">
            {selectedRecipients.map((r) => (
              <p key={r.key} className="truncate text-muted-foreground">
                {r.name} · {r.email}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending}>
              Back
            </Button>
            <Button onClick={doSend} disabled={sending}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? "Queueing…" : "Send campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule for later — drained by the duties engine when due */}
      <Dialog open={scheduling} onOpenChange={setScheduling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule this campaign</DialogTitle>
            <DialogDescription>
              It sends automatically once this time passes.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Scheduled sends run from the background job. If no admin has the app
            open, set up the cron ping so they fire on time.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduling(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={doSchedule} disabled={sending || !scheduleAt}>
              {sending ? <Loader2 className="animate-spin" /> : <Clock />} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
