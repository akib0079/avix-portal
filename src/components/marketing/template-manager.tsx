"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTemplate } from "@/lib/actions/marketing";
import { TemplateFormDialog } from "./template-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { richTextToPlain } from "@/lib/rich-text";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Mail, Send } from "lucide-react";

export type TemplateView = {
  id: string;
  name: string;
  subject: string;
  body: unknown;
  updatedAt: string;
};

export function TemplateManager({ templates }: { templates: TemplateView[] }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateView | null>(null);
  const [deleting, setDeleting] = useState<TemplateView | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {templates.length} template{templates.length === 1 ? "" : "s"} · start a campaign from
          any of them
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/60 py-14 text-center text-sm text-muted-foreground">
          No templates yet — save your first offer or update email.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => {
            const preview = richTextToPlain(template.body).trim();
            return (
              <article
                key={template.id}
                className="surface surface-link group flex flex-col overflow-hidden"
              >
                {/* A glimpse of the email, so templates are told apart by
                    what they say, not only by name. */}
                <div className="relative h-28 overflow-hidden border-b bg-[var(--chat-canvas)] px-4 pt-3">
                  <div className="h-full rounded-t-lg border border-b-0 bg-card px-3 pt-2.5">
                    <p className="truncate text-[11px] font-semibold">{template.subject}</p>
                    <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-muted-foreground">
                      {preview || "No content yet."}
                    </p>
                  </div>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--chat-canvas)] to-transparent" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-primary">
                      <Mail className="size-3.5" />
                    </span>
                    <span className="truncate">{template.name}</span>
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Updated {formatDate(template.updatedAt)}
                  </p>
                  <div className="mt-auto flex items-center gap-1.5 pt-4">
                    <Button asChild size="sm" className="flex-1">
                      <Link href={`/admin/marketing/new?template=${template.id}`}>
                        <Send /> Use in campaign
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        setEditing(template);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleting(template)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TemplateFormDialog template={editing} open={formOpen} onOpenChange={setFormOpen} />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              Campaigns already sent from this template are kept. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                const result = await deleteTemplate(deleting.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Template deleted.");
                setDeleting(null);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
