import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { CampaignRetryButton } from "@/components/marketing/campaign-retry-button";
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
import { ArrowLeft, CheckCircle2, XCircle, Clock3 } from "lucide-react";

export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const delivered = campaign.recipients.filter((r) => r.sentAt).length;
  const failed = campaign.recipients.length - delivered;

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
        description={`Sent ${formatDate(campaign.sentAt ?? campaign.createdAt)} · ${delivered} of ${campaign.recipients.length} delivered`}
        action={failed > 0 ? <CampaignRetryButton campaignId={campaign.id} /> : undefined}
      />

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
                <TableHead>Client</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.user.firstName} {r.user.lastName}
                    {r.user.company ? (
                      <span className="text-muted-foreground"> — {r.user.company}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {r.user.email}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium",
                        r.sentAt
                          ? "text-emerald-600"
                          : r.error
                            ? "text-red-600"
                            : "text-slate-500",
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
