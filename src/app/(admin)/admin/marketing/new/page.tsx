import Link from "next/link";
import { listTemplates, listAudience, listSegments } from "@/lib/dal/marketing";
import type { AudienceFilterInput } from "@/lib/validation/marketing";
import { PageHeader } from "@/components/page-header";
import { CampaignComposer } from "@/components/marketing/campaign-composer";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "New Campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireAdmin();
  const { template } = await searchParams;
  const [templates, audience, segments] = await Promise.all([
    listTemplates(),
    listAudience(),
    listSegments(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Link href="/admin/marketing" className="hover:text-foreground">
          Marketing
        </Link>
        <ChevronRight className="size-3 shrink-0" />
        <span className="text-foreground/80">New campaign</span>
      </nav>
      <PageHeader
        title="New Campaign"
        description="Compose, pick recipients, preview, then send."
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
        initialTemplateId={template}
      />
    </div>
  );
}
