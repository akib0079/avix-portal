"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveMilestone, claimInvoicePayment } from "@/lib/actions/portal";
import type { ClientActionItems } from "@/lib/dal/portal-actions";
import { workItemHref } from "@/lib/board";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  CircleCheckBig,
  CheckCircle2,
  Loader2,
  Milestone as MilestoneIcon,
  Receipt,
  ExternalLink,
  LifeBuoy,
  ArrowRight,
  ThumbsUp,
} from "lucide-react";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

function fmtDate(d: Date | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ActionCenter({ items }: { items: ClientActionItems }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong.");
      }
      setBusyId(null);
    });
  }

  if (items.count === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CircleCheckBig className="size-10 text-emerald-500" />
          <p className="font-heading text-lg font-semibold">You&apos;re all caught up</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Nothing needs your attention right now. Work to review, questions
            from the team and invoices to pay will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {items.questions.length > 0 && (
        <section>
          <h2 className="font-heading mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <LifeBuoy className="size-4" /> Questions from the team ({items.questions.length})
          </h2>
          <div className="space-y-2">
            {items.questions.map((t) => (
              <Link
                key={t.id}
                href={workItemHref(t.projectId, t.id, "CLIENT")}
                className="group flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                      <LifeBuoy className="size-3" /> Question
                    </span>
                    <span className="truncate font-medium">{t.title}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{t.projectName}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {items.reviews.length > 0 && (
        <section>
          <h2 className="font-heading mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <MilestoneIcon className="size-4" /> Ready for your review ({items.reviews.length})
          </h2>
          <div className="space-y-2">
            {items.reviews.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <Link
                      href={workItemHref(m.projectId, m.id, "CLIENT")}
                      className="font-medium hover:text-primary"
                    >
                      {m.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">{m.projectName}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      run(m.id, () => approveMilestone(m.id), "Milestone approved — thank you!")
                    }
                    disabled={pending}
                  >
                    {busyId === m.id ? (
                      <>
                        <Loader2 className="animate-spin" /> Approving…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 /> Approve
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {items.toRate.length > 0 && (
        <section>
          <h2 className="font-heading mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <ThumbsUp className="size-4" /> How did it go? ({items.toRate.length})
          </h2>
          <div className="space-y-2">
            {items.toRate.map((m) => (
              <Link
                key={m.id}
                href={workItemHref(m.projectId, m.id, "CLIENT", "list")}
                className="group flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">Rate “{m.title}”</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{m.projectName}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {items.invoices.length > 0 && (
        <section>
          <h2 className="font-heading mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Receipt className="size-4" /> Invoices to pay ({items.invoices.length})
          </h2>
          <div className="space-y-2">
            {items.invoices.map((i) => (
              <Card key={i.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {i.invoiceNumber} · {money(i.amount, i.currency)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {i.projectName ? `${i.projectName} · ` : ""}
                      {i.dueDate ? `due ${fmtDate(i.dueDate)}` : "no due date"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/portal/invoices/${i.id}`}>
                        <ExternalLink /> View
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        run(
                          i.id,
                          () => claimInvoicePayment(i.id),
                          "Thanks — we'll confirm your payment shortly.",
                        )
                      }
                      disabled={pending}
                    >
                      {busyId === i.id ? (
                        <>
                          <Loader2 className="animate-spin" /> Saving…
                        </>
                      ) : (
                        "I've paid this"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
