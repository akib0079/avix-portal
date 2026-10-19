import Link from "next/link";
import type { CSSProperties } from "react";
import type { getCampaign } from "@/lib/dal/marketing";
import { CampaignRetryButton } from "@/components/marketing/campaign-retry-button";
import { CampaignSendControls } from "@/components/marketing/campaign-send-controls";
import { RecipientList } from "@/components/marketing/recipient-list";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { SoftPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { campaignStatusColor } from "@/lib/status-colors";
import { formatDate } from "@/lib/format";
import { ChevronRight, Pencil } from "lucide-react";

export type CampaignDetailData = NonNullable<Awaited<ReturnType<typeof getCampaign>>>;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Needs attention",
};

/** The campaign page body: header band, the email as it reads, and who got it. */
export function CampaignDetail({ campaign }: { campaign: CampaignDetailData }) {

  const total = campaign.recipients.length;
  const delivered = campaign.recipients.filter((r) => r.sentAt).length;
  const failed = campaign.recipients.filter((r) => !r.sentAt && r.error).length;
  const pending = total - delivered - failed;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const color = campaignStatusColor[campaign.status];

  const subtitle =
    campaign.status === "SCHEDULED" && campaign.scheduledAt
      ? `Scheduled for ${formatDate(campaign.scheduledAt)}`
      : campaign.sentAt
        ? `Sent ${formatDate(campaign.sentAt)}`
        : `Created ${formatDate(campaign.createdAt)}`;

  return (
    <div className="space-y-5">
      {/* The campaign as a header band, coloured by where it stands. */}
      <section className="surface overflow-hidden" style={{ "--col": color } as CSSProperties}>
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[var(--col)] opacity-80" />
        <div className="p-5 sm:p-6">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Link href="/admin/marketing" className="hover:text-foreground">
              Marketing
            </Link>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate text-foreground/80">{campaign.name ?? "Campaign"}</span>
          </nav>

          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="title-page text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[1.75rem]">
                {campaign.subject}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <SoftPill color={color}>{STATUS_LABEL[campaign.status] ?? campaign.status}</SoftPill>
                <span>
                  {subtitle} · {total} recipient{total === 1 ? "" : "s"}
                </span>
              </div>
            </div>
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
          </div>

          {/* Delivery: one bar, three numbers. */}
          <div className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
            <span className="h-full bg-emerald-500" style={{ width: `${pct(delivered)}%` }} />
            <span className="h-full bg-red-500" style={{ width: `${pct(failed)}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: "Delivered", value: delivered, dot: "bg-emerald-500" },
              { label: "Pending", value: pending, dot: "bg-slate-400" },
              { label: "Failed", value: failed, dot: "bg-red-500" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border bg-muted/40 px-3 py-2">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className={`size-1.5 rounded-full ${s.dot}`} /> {s.label}
                </dt>
                <dd className="num mt-0.5 text-lg font-bold">{s.value}</dd>
              </div>
            ))}
          </dl>
          {(campaign.status === "QUEUED" || campaign.status === "SCHEDULED") && (
            <p className="mt-3 text-xs text-muted-foreground">
              Queued sends run from the background job, which fires when an admin opens the app (or
              when the cron endpoint is pinged). Use &ldquo;Send now&rdquo; to push it through
              immediately.
            </p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* The email as it reads in an inbox. */}
        <section className="surface overflow-hidden">
          <div className="border-b p-4 sm:p-5">
            <p className="eyebrow">Email</p>
            <p className="mt-1.5 text-sm">
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-semibold">{campaign.subject}</span>
            </p>
          </div>
          <div className="bg-[var(--chat-canvas)] p-3 sm:p-5">
            <div className="mx-auto max-w-[600px] rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <RichTextViewer content={campaign.body} />
            </div>
          </div>
        </section>

        {/* Failures first on a phone: they are why you opened the page. */}
        <div className={failed > 0 ? "order-first min-w-0 lg:order-none" : "min-w-0"}>
          <RecipientList
            recipients={campaign.recipients.map((r) => ({
              id: r.id,
              name: r.user
                ? `${r.user.firstName} ${r.user.lastName}`.trim()
                : (r.lead?.name ?? r.firstName ?? r.email ?? "Recipient"),
              email: r.email ?? r.user?.email ?? "",
              company: r.company,
              isLead: !!r.leadId,
              state: r.sentAt ? "delivered" : r.error ? "failed" : "pending",
              error: r.sentAt ? null : r.error,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
