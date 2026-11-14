import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead, listLeadOwners } from "@/lib/dal/leads";
import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { LeadDetailActions } from "@/components/leads/lead-detail-actions";
import { LeadBadges, LeadDetailBody } from "@/components/leads/lead-detail-body";
import { formatDate } from "@/lib/format";
import { leadSourceLabels } from "@/lib/validation/lead";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Lead" };

/**
 * The full lead page: a direct link, a refresh, or a link from outside the
 * board. Opening a lead from the board itself shows the same body in a popup
 * instead (leads/@modal/(.)[id]).
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [lead, owners] = await Promise.all([getLead(id), listLeadOwners()]);
  if (!lead) notFound();

  return (
    <div>
      <Link
        href="/admin/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Leads
      </Link>

      <PageHeader
        title={lead.name}
        description={`${leadSourceLabels[lead.source]} · added ${formatDate(lead.createdAt)}`}
        action={<LeadDetailActions lead={lead} owners={owners} />}
      />

      <LeadBadges lead={lead} className="mb-6" />
      <LeadDetailBody lead={lead} />
    </div>
  );
}
