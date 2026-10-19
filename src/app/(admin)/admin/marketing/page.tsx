import Link from "next/link";
import { listCampaigns } from "@/lib/dal/marketing";
import { getBookingConfig } from "@/lib/dal/availability";
import { PageHeader } from "@/components/page-header";
import { CampaignsView } from "@/components/marketing/campaigns-view";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HUE } from "@/lib/status-colors";
import { Megaphone, Plus, Mail, Send, MailCheck, CalendarClock, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Marketing" };

export default async function MarketingPage() {
  await requireAdmin();
  const [campaigns, booking] = await Promise.all([listCampaigns(), getBookingConfig()]);
  const now = serverNow();
  const tz = booking.agencyTimezone;

  // Labels are formatted here, in the agency's zone: the board renders on a
  // UTC host first, and a scheduled send's time must not shift on hydration.
  const fmt = (d: Date, withTime: boolean) => {
    const opts: Intl.DateTimeFormatOptions = withTime
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" };
    try {
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(d);
    } catch {
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
    }
  };
  const whenLabel = (c: (typeof campaigns)[number]) => {
    if (c.status === "SCHEDULED" && c.scheduledAt) return `Goes out ${fmt(c.scheduledAt, true)}`;
    if (c.status === "SENT" && c.sentAt) return `Sent ${fmt(c.sentAt, false)}`;
    if ((c.status === "QUEUED" || c.status === "SENDING") && c.startedAt)
      return `Started ${fmt(c.startedAt, true)}`;
    if (c.status === "QUEUED" || c.status === "SENDING") return "Queued to send";
    if (c.status === "FAILED") return `Ran ${fmt(c.sentAt ?? c.startedAt ?? c.createdAt, false)}`;
    return `Created ${fmt(c.createdAt, false)}`;
  };

  const sent = campaigns.filter((c) => c.status === "SENT").length;
  const delivered = campaigns.reduce((sum, c) => sum + c.sentCount, 0);
  const nextScheduled = campaigns
    .filter((c) => c.status === "SCHEDULED" && c.scheduledAt && c.scheduledAt.getTime() > now)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];
  const needRetry = campaigns.filter((c) => c.status === "FAILED" || c.failedCount > 0).length;

  return (
    <div>
      <PageHeader
        title="Marketing"
        description="Send offers and updates to your clients and leads."
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

      {campaigns.length === 0 ? (
        <Card>
          <CardContent>
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
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatTile i={0} icon={Send} label="Campaigns sent" value={String(sent)} color={HUE.green} />
            <StatTile
              i={1}
              icon={MailCheck}
              label="Emails delivered"
              value={delivered.toLocaleString("en-US")}
              color={HUE.blue}
            />
            <StatTile
              i={2}
              icon={CalendarClock}
              label="Next send"
              value={nextScheduled ? fmt(nextScheduled.scheduledAt!, false).replace(/, \d{4}$/, "") : "—"}
              sub={nextScheduled ? nextScheduled.subject : "Nothing scheduled"}
              color={HUE.violet}
            />
            <StatTile
              i={3}
              icon={TriangleAlert}
              label="Need a retry"
              value={String(needRetry)}
              sub={needRetry > 0 ? "Open one to resend the failures" : "All delivered"}
              color={needRetry > 0 ? HUE.red : HUE.slate}
            />
          </div>

          <CampaignsView
            campaigns={campaigns.map((c) => ({
              id: c.id,
              subject: c.subject,
              name: c.name,
              status: c.status,
              whenLabel: whenLabel(c),
              recipients: c._count.recipients,
              delivered: c.sentCount,
              failed: c.failedCount,
            }))}
          />
        </>
      )}
    </div>
  );
}
