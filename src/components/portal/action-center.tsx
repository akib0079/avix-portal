"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { approveMilestone, claimInvoicePayment, sendBackMilestone } from "@/lib/actions/portal";
import { reviewDeliverable } from "@/lib/actions/deliverables";
import type { ClientActionItems } from "@/lib/dal/portal-actions";
import { COLUMN_BY_ID, workItemHref } from "@/lib/board";
import { HUE } from "@/lib/status-colors";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { SendBackDialog } from "@/components/board/work-dialogs";
import { RateMilestone } from "@/components/portal/rate-milestone";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  CircleCheckBig,
  CircleX,
  Download,
  ExternalLink,
  Eye,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  Package,
  Receipt,
  ThumbsUp,
  Undo2,
} from "lucide-react";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Everything waiting on the client, in one list, each with the one action it
 * asks for — answered without leaving the page where it can be: approve or
 * send back work, pay an invoice, approve a file, rate a finished
 * milestone. A question opens its item, where the thread is. Requests the
 * team declined lately close the list, with the reason and a way to ask
 * again.
 *
 * A handled row leaves at once. The approvals revalidate this page, and the
 * rest only ever remove a row, so nothing here asks the server to render
 * the page twice.
 */
export function ActionCenter({
  items,
  projects,
}: {
  items: ClientActionItems;
  /** For "Ask again" on a declined request. */
  projects: { id: string; projectName: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [sendingBack, setSendingBack] = useState<{ id: string; title: string } | null>(null);
  const live = <T extends { id: string }>(kind: string, list: T[]) => list.filter((x) => !done.has(`${kind}:${x.id}`));

  function run(key: string, fn: () => Promise<Result>, okMsg: string) {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(okMsg);
      setDone((prev) => new Set(prev).add(key));
    });
  }

  const reviews = live("review", items.reviews);
  const questions = live("question", items.questions);
  const toRate = live("rate", items.toRate);
  const deliverables = live("file", items.deliverables);
  const invoices = live("invoice", items.invoices);
  const remaining = reviews.length + questions.length + toRate.length + deliverables.length + invoices.length;

  return (
    <div className="space-y-6">
      {remaining === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CircleCheckBig className="size-10 text-emerald-500" />
            <p className="font-heading text-lg font-semibold">You&apos;re all caught up</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing needs your attention right now. Work to review, questions from the team, files to
              check and invoices to pay will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {questions.length > 0 && (
            <Group icon={LifeBuoy} title="Questions from the team" count={questions.length} color={HUE.red}>
              {questions.map((q) => (
                <Row
                  key={q.id}
                  title={q.title}
                  meta={q.projectName}
                  href={workItemHref(q.projectId, q.id, "CLIENT", "list")}
                  actions={
                    <Button asChild size="sm">
                      <Link href={workItemHref(q.projectId, q.id, "CLIENT", "list")}>
                        Answer <ArrowRight />
                      </Link>
                    </Button>
                  }
                />
              ))}
            </Group>
          )}

          {reviews.length > 0 && (
            <Group icon={Eye} title="Ready for your review" count={reviews.length} color={COLUMN_BY_ID.REVIEW.color}>
              {reviews.map((m) => {
                const key = `review:${m.id}`;
                return (
                  <Row
                    key={m.id}
                    title={m.title}
                    meta={m.projectName}
                    href={workItemHref(m.projectId, m.id, "CLIENT", "list")}
                    actions={
                      <>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => run(key, () => approveMilestone(m.id), "Approved — thank you!")}
                        >
                          {busy === key ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setSendingBack({ id: m.id, title: m.title })}
                        >
                          <Undo2 /> Send back
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </Group>
          )}

          {invoices.length > 0 && (
            <Group icon={Receipt} title="Invoices to pay" count={invoices.length} color={HUE.blue}>
              {invoices.map((i) => {
                const key = `invoice:${i.id}`;
                return (
                  <Row
                    key={i.id}
                    title={`${i.invoiceNumber} · ${formatCurrency(i.balance, i.currency)}${i.partlyPaid ? " left" : ""}`}
                    meta={
                      <>
                        {i.projectName ? `${i.projectName} · ` : ""}
                        {i.partlyPaid ? `of ${formatCurrency(i.amount, i.currency)} · ` : ""}
                        <span className={cn(i.overdue && "font-medium text-red-600 dark:text-red-400")}>
                          {i.dueDate ? `${i.overdue ? "was due" : "due"} ${formatDate(i.dueDate)}` : "no due date"}
                        </span>
                      </>
                    }
                    href={`/portal/invoices/${i.id}`}
                    actions={
                      <>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/portal/invoices/${i.id}`}>
                            <ExternalLink /> View
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(key, () => claimInvoicePayment(i.id), "Thanks — we'll confirm your payment shortly.")
                          }
                        >
                          {busy === key ? <Loader2 className="animate-spin" /> : null} I&apos;ve paid this
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </Group>
          )}

          {deliverables.length > 0 && (
            <Group icon={Package} title="Files to check" count={deliverables.length} color={HUE.violet}>
              {deliverables.map((d) => {
                const key = `file:${d.id}`;
                return (
                  <Row
                    key={d.id}
                    title={d.title}
                    meta={`${d.projectName} · shared ${formatDate(d.createdAt)}`}
                    href={`/portal/projects/${d.projectId}?tab=files`}
                    actions={
                      <>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/api/files/deliverable/${d.id}`} prefetch={false} target="_blank">
                            {d.external ? <ExternalLink /> : <Download />} {d.external ? "Open" : "Download"}
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(key, () => reviewDeliverable(d.id, "APPROVED"), "Approved — thanks for the go-ahead!")
                          }
                        >
                          {busy === key ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/portal/projects/${d.projectId}?tab=files`}>Ask for changes</Link>
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </Group>
          )}

          {toRate.length > 0 && (
            <Group icon={ThumbsUp} title="How did it go?" count={toRate.length} color={COLUMN_BY_ID.DONE.color}>
              {toRate.map((m) => (
                <Row
                  key={m.id}
                  title={m.title}
                  meta={m.projectName}
                  href={workItemHref(m.projectId, m.id, "CLIENT", "list")}
                  below={<RateMilestone milestoneId={m.id} rating={null} note={null} />}
                />
              ))}
            </Group>
          )}
        </>
      )}

      {items.declined.length > 0 && (
        <Group icon={CircleX} title="Recently declined" color={HUE.muted} hint="The team's reasons, for your records.">
          {items.declined.map((r) => (
            <Row
              key={r.id}
              title={r.title}
              meta={`${r.projectName}${r.resolvedAt ? ` · ${formatDate(r.resolvedAt)}` : ""}`}
              below={
                r.note ? (
                  <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Note from Avix Digital:</span> {r.note}
                  </p>
                ) : null
              }
              actions={
                projects.some((p) => p.id === r.projectId) ? (
                  <RequestFormDialog
                    projects={projects.filter((p) => p.id === r.projectId)}
                    defaultProjectId={r.projectId}
                    defaultTitle={r.title}
                    trigger={
                      <Button size="sm" variant="outline">
                        <MessageSquarePlus /> Ask again
                      </Button>
                    }
                  />
                ) : null
              }
            />
          ))}
        </Group>
      )}

      <SendBackDialog
        open={!!sendingBack}
        title={sendingBack?.title ?? ""}
        to="IN_PROGRESS"
        onCancel={() => setSendingBack(null)}
        onSend={async (note) => {
          if (!sendingBack) return false;
          const res = await sendBackMilestone(sendingBack.id, note);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Sent back — the team has your note.");
          setDone((prev) => new Set(prev).add(`review:${sendingBack.id}`));
          setSendingBack(null);
          return true;
        }}
      />
    </div>
  );
}

/** One kind of thing waiting, under its heading, in the colour it carries everywhere else. */
function Group({
  icon: Icon,
  title,
  count,
  color,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  color: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ "--c": color } as CSSProperties}>
      <h2 className="font-heading mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span className="flex size-6 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--c)_13%,transparent)] text-[color-mix(in_oklab,var(--c)_80%,var(--foreground))]">
          <Icon className="size-3.5" />
        </span>
        {title}
        {count !== undefined && <span className="tabular-nums">({count})</span>}
        {hint && <span className="font-sans text-xs font-normal">— {hint}</span>}
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Row({
  title,
  meta,
  href,
  actions,
  below,
}: {
  title: string;
  meta: ReactNode;
  href?: string;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <li className="relative overflow-hidden rounded-xl border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--c)] opacity-70" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="font-medium [overflow-wrap:anywhere] hover:text-primary">
              {title}
            </Link>
          ) : (
            <p className="font-medium [overflow-wrap:anywhere]">{title}</p>
          )}
          <p className="text-sm text-muted-foreground">{meta}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {below}
    </li>
  );
}
