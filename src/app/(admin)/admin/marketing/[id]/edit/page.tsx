import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { getCampaign, listTemplates, listAudience, listSegments } from "@/lib/dal/marketing";
import type { AudienceFilterInput } from "@/lib/validation/marketing";
import { PageHeader } from "@/components/page-header";
import { CampaignComposer } from "@/components/marketing/campaign-composer";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Edit Campaign" };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [campaign, templates, audience, segments] = await Promise.all([
    getCampaign(id),
    listTemplates(),
    listAudience(),
    listSegments(),
  ]);
  if (!campaign) notFound();
  // Once it's queued the recipient rows are being written to — read-only from here.
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    redirect(`/admin/marketing/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/admin/marketing/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>
      <PageHeader
        title="Edit campaign"
        description="Change the copy or the audience, then save, schedule or send."
      />
      <CampaignComposer
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          body: t.body,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        audience={audience}
        segments={segments.map((seg) => ({
          id: seg.id,
          name: seg.name,
          filter: seg.filter as AudienceFilterInput,
        }))}
        draft={{
          id: campaign.id,
          subject: campaign.subject,
          body: (campaign.body as JSONContent) ?? null,
          templateId: campaign.templateId,
          recipientIds: campaign.recipients
            .map((r) =>
              r.userId ? `client:${r.userId}` : r.leadId ? `lead:${r.leadId}` : null,
            )
            .filter((v): v is string => Boolean(v)),
        }}
      />
    </div>
  );
}
