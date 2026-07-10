import Link from "next/link";
import { listCampaigns } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Megaphone, Plus, Mail, ChevronRight } from "lucide-react";
import type { CampaignStatus } from "@prisma/client";

export const metadata = { title: "Marketing" };

const statusStyles: Record<CampaignStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENDING: "bg-blue-50 text-blue-600",
  SENT: "bg-emerald-50 text-emerald-600",
  FAILED: "bg-red-50 text-red-600",
};

const statusLabels: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Needs retry",
};

export default async function MarketingPage() {
  const campaigns = await listCampaigns();

  return (
    <div>
      <PageHeader
        title="Marketing"
        description="Send offers and updates to your clients."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/marketing/templates">
                <Mail /> Templates
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/marketing/new">
                <Plus /> New campaign
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Megaphone className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No campaigns yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Send your first offer or update to your clients.
              </p>
              <Button asChild className="mt-4">
                <Link href="/admin/marketing/new">
                  <Plus /> New campaign
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden sm:table-cell">Sent</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow
                    key={campaign.id}
                    className="group relative cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/marketing/${campaign.id}`}
                        className="block after:absolute after:inset-0"
                      >
                        {campaign.subject}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(campaign.sentAt ?? campaign.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {campaign.sentCount} / {campaign._count.recipients}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          statusStyles[campaign.status],
                        )}
                      >
                        {statusLabels[campaign.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
