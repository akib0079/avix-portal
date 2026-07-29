"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeliverableRow } from "@/lib/dal/deliverables";
import { reviewDeliverable } from "@/lib/actions/deliverables";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import {
  Package,
  FileText,
  ExternalLink,
  Download,
  CheckCircle2,
  MessageSquareWarning,
  Loader2,
} from "lucide-react";

/** Client-facing deliverables: download/open, then approve or ask for changes. */
export function DeliverablesList({ deliverables }: { deliverables: DeliverableRow[] }) {
  const router = useRouter();
  const [openNoteFor, setOpenNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (deliverables.length === 0) return null;

  function submit(id: string, decision: "APPROVED" | "CHANGES_REQUESTED", text?: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await reviewDeliverable(id, decision, text);
      setBusyId(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        decision === "APPROVED"
          ? "Approved — thanks for the go-ahead!"
          : "Sent — we'll get on those changes.",
      );
      setOpenNoteFor(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <h2 className="font-heading mb-4 flex items-center gap-2 text-lg font-semibold">
          <Package className="size-5 text-primary" /> Deliverables
        </h2>
        <ul className="divide-y">
          {deliverables.map((d) => {
            const reviewed = d.reviewStatus !== null;
            const approved = d.reviewStatus === "APPROVED";
            return (
              <li key={d.id} className="py-3 first:pt-0">
                <div className="flex items-center gap-3">
                  {d.externalUrl ? (
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</p>
                  </div>
                  <Link
                    href={`/api/files/deliverable/${d.id}`}
                    prefetch={false}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {d.externalUrl ? (
                      <>
                        <ExternalLink className="size-3.5" /> Open
                      </>
                    ) : (
                      <>
                        <Download className="size-3.5" /> Download
                      </>
                    )}
                  </Link>
                </div>

                {/* Review state, or the approve / request-changes controls */}
                {reviewed ? (
                  <p
                    className={
                      "mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium " +
                      (approved
                        ? "text-emerald-600 dark:text-emerald-300"
                        : "text-amber-600 dark:text-amber-300")
                    }
                  >
                    {approved ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <MessageSquareWarning className="size-3.5" />
                    )}
                    {approved ? "You approved this" : "Changes requested"}
                    {d.reviewNote ? (
                      <span className="font-normal text-muted-foreground">
                        — “{d.reviewNote}”
                      </span>
                    ) : null}
                  </p>
                ) : openNoteFor === d.id ? (
                  <div className="mt-2 rounded-xl border bg-muted/40 p-3">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      placeholder="What would you like changed?"
                      className="text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 rounded-full"
                        disabled={pending}
                        onClick={() => submit(d.id, "CHANGES_REQUESTED", note)}
                      >
                        {busyId === d.id ? <Loader2 className="animate-spin" /> : null}
                        Send request
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-full"
                        disabled={pending}
                        onClick={() => {
                          setOpenNoteFor(null);
                          setNote("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full"
                      disabled={pending}
                      onClick={() => submit(d.id, "APPROVED")}
                    >
                      {busyId === d.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-full"
                      disabled={pending}
                      onClick={() => setOpenNoteFor(d.id)}
                    >
                      <MessageSquareWarning className="size-3.5" /> Request changes
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
