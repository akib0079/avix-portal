import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { CampaignRetryButton } from "@/components/marketing/campaign-retry-button";
import { CampaignSendControls } from "@/components/marketing/campaign-send-controls";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle, Clock3, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const total = campaign.recipients.length;
  const delivered = campaign.recipients.filter((r) => r.sentAt).length;
  const failed = campaign.recipients.filter((r) => !r.sentAt && r.error).length;
  const pending = total - delivered - failed;
  const pct = total === 0 ? 0 : Math.round((delivered / total) * 100);

  const statusLabel: Record<string, string> = {
    DRAFT: "Draft",
    SCHEDULED: "Scheduled",
    QUEUED: "Queued",
    SENDING: "Sending",
    SENT: "Sent",
    FAILED: "Needs attention",
  };
  const statusTone: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SCHEDULED: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    QUEUED: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    SENDING: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    SENT: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    FAILED: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  };

  const subtitle =
    campaign.status === "SCHEDULED" && campaign.scheduledAt
      ? `Scheduled for ${formatDate(campaign.scheduledAt)}`
      : campaign.sentAt
        ? `Sent ${formatDate(campaign.sentAt)} · ${delivered} of ${total} delivered`
        : `Created ${formatDate(campaign.createdAt)} · ${total} recipient${total === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/marketing"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Marketing
      </Link>
      <PageHeader
        title={campaign.subject}
        description={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(campaign.status === "DRAFT" || campaign.status === "SCHEDULED") && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/marketing/${campaign.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {failed > 0 && <CampaignRetryButton campaignId={campaign.id} />}
            <CampaignSendControls
              campaignId={campaign.id}
              status={campaign.status}
              pending={pending}
            />
          </div>
        }
      />

      {/* Delivery progress */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                statusTone[campaign.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {statusLabel[campaign.status] ?? campaign.status}
            </span>
            <span className="text-sm text-muted-foreground">
              {delivered} delivered · {pending} pending · {failed} failed
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          {(campaign.status === "QUEUED" || campaign.status === "SCHEDULED") && (
            <p className="mt-3 text-xs text-muted-foreground">
              Queued sends run from the background job, which fires when an admin
              opens the app (or when the cron endpoint is pinged). Use
              &ldquo;Send now&rdquo; to push it through immediately.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-heading text-lg">Email content</CardTitle>
        </CardHeader>
        <CardContent>
          <RichTextViewer content={campaign.body} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Recipients ({campaign.recipients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.user
                      ? `${r.user.firstName} ${r.user.lastName}`.trim()
                      : (r.lead?.name ?? r.firstName ?? r.email)}
                    {r.company ? (
                      <span className="text-muted-foreground"> — {r.company}</span>
                    ) : null}
                    {r.leadId && (
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Lead
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {r.email ?? r.user?.email}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium",
                        r.sentAt
                          ? "text-emerald-600"
                          : r.error
                            ? "text-red-600"
                            : "text-muted-foreground",
                      )}
                      title={r.error ?? undefined}
                    >
                      {r.sentAt ? (
                        <>
                          <CheckCircle2 className="size-3.5" /> Delivered
                        </>
                      ) : r.error ? (
                        <>
                          <XCircle className="size-3.5" /> Failed
                        </>
                      ) : (
                        <>
                          <Clock3 className="size-3.5" /> Pending
                        </>
                      )}
                    </span>
                    {r.error && (
                      <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">
                        {r.error}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
