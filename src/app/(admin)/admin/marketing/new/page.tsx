import Link from "next/link";
import { listTemplates, listMarketingRecipients } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { CampaignComposer } from "@/components/marketing/campaign-composer";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "New Campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  const [templates, recipients] = await Promise.all([
    listTemplates(),
    listMarketingRecipients(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/marketing"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Marketing
      </Link>
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
        recipients={recipients}
        initialTemplateId={template}
      />
    </div>
  );
}
