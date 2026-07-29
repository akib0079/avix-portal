"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createDeliverable, deleteDeliverable } from "@/lib/actions/deliverables";
import type { DeliverableRow } from "@/lib/dal/deliverables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Package,
  Upload,
  Link2,
  Trash2,
  Loader2,
  FileText,
  ExternalLink,
} from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DeliverablesCard({
  projectId,
  deliverables,
}: {
  projectId: string;
  deliverables: DeliverableRow[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createDeliverable(projectId, formData);
      if (res.ok) {
        toast.success("Deliverable posted — the client has been notified.");
        formRef.current?.reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteDeliverable(id);
      if (res.ok) {
        toast.success("Deliverable removed.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
      setDeletingId(null);
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-lg">
          <Package className="size-5 text-primary" /> Deliverables
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deliverable-title">Title</Label>
            <Input
              id="deliverable-title"
              name="title"
              placeholder="e.g. Homepage design v2"
              maxLength={160}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="deliverable-file" className="flex items-center gap-1.5">
                <Upload className="size-3.5" /> File{" "}
                <span className="text-muted-foreground">(PDF or image)</span>
              </Label>
              <Input
                id="deliverable-file"
                name="file"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deliverable-link" className="flex items-center gap-1.5">
                <Link2 className="size-3.5" /> or Link
              </Label>
              <Input
                id="deliverable-link"
                name="externalUrl"
                type="url"
                placeholder="https://figma.com/…"
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending && !deletingId ? (
              <>
                <Loader2 className="animate-spin" /> Posting…
              </>
            ) : (
              "Post deliverable"
            )}
          </Button>
        </form>

        {deliverables.length > 0 && (
          <ul className="mt-5 divide-y border-t">
            {deliverables.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                {d.externalUrl ? (
                  <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/api/files/deliverable/${d.id}`}
                    prefetch={false}
                    target="_blank"
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {d.externalUrl ? "Link" : d.fileOriginalName ?? "File"} ·{" "}
                    {formatDate(d.createdAt.toISOString())}
                  </p>
                  {d.reviewStatus && (
                    <p
                      title={d.reviewNote ?? undefined}
                      className={
                        "mt-0.5 text-xs font-medium " +
                        (d.reviewStatus === "APPROVED"
                          ? "text-emerald-600 dark:text-emerald-300"
                          : "text-amber-600 dark:text-amber-300")
                      }
                    >
                      {d.reviewStatus === "APPROVED"
                        ? "✓ Client approved"
                        : "⟳ Changes requested"}
                      {d.reviewNote ? ` · “${d.reviewNote}”` : ""}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(d.id)}
                  disabled={pending}
                >
                  {deletingId === d.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
