import { getLead, listLeadOwners } from "@/lib/dal/leads";
import { requireAdmin } from "@/lib/dal/session";
import { LeadDetailActions } from "@/components/leads/lead-detail-actions";
import { LeadBadges, LeadDetailBody } from "@/components/leads/lead-detail-body";
import { LeadModal } from "@/components/leads/lead-modal";
import { formatDate, initials } from "@/lib/format";
import { leadSourceLabels } from "@/lib/validation/lead";
import { leadStageColor } from "@/lib/status-colors";
import { Maximize2 } from "lucide-react";

/**
 * A lead opened from the board: the same details as /admin/leads/[id], in a
 * popup over the board. Refreshing or sharing the URL gives the full page.
 */
export default async function LeadPopup({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [lead, owners] = await Promise.all([getLead(id), listLeadOwners()]);

  if (!lead) {
    return (
      <LeadModal title="Lead not found">
        <p className="p-8 text-center text-sm text-muted-foreground">
          This lead no longer exists. It may have been deleted.
        </p>
      </LeadModal>
    );
  }

  const subtitle = [lead.company, leadSourceLabels[lead.source], `added ${formatDate(lead.createdAt)}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <LeadModal title={lead.name} description={subtitle}>
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b px-4 pt-4 pb-3 pr-12 sm:px-6 sm:pt-5 sm:pr-14">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: leadStageColor[lead.stage] }}
          >
            {initials(lead.name)}
          </span>
          <div className="min-w-0">
            <h2 className="font-heading truncate text-xl font-bold">{lead.name}</h2>
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadDetailActions lead={lead} owners={owners} />
          {/* A plain link on purpose: a client-side one would open this popup again. */}
          <a
            href={`/admin/leads/${lead.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Open as a full page"
          >
            <Maximize2 className="size-3.5" /> Full page
          </a>
        </div>
        <LeadBadges lead={lead} className="w-full" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4 sm:p-6">
        <LeadDetailBody lead={lead} />
      </div>
    </LeadModal>
  );
}
