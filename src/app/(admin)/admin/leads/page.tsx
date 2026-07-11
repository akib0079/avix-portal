import { listLeads } from "@/lib/dal/leads";
import { PageHeader } from "@/components/page-header";
import { LeadBoard } from "@/components/leads/lead-board";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const leads = await listLeads();

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Your sales pipeline — from first contact to signed client."
      />
      <LeadBoard leads={leads} />
    </div>
  );
}
