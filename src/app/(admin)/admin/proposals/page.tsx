import { listProposals } from "@/lib/dal/proposals";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { ProposalManager } from "@/components/proposals/proposal-manager";

export const metadata = { title: "Proposals" };

export default async function ProposalsPage() {
  await requireAdmin();
  const [proposals, leads] = await Promise.all([
    listProposals(),
    prisma.lead.findMany({
      // Won/lost leads are done — proposals are built for live ones.
      where: { stage: { in: ["NEW", "CONTACTED", "PROPOSAL"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        company: true,
        estimatedValue: true,
        brandInfo: true,
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Send a scope and price. When they accept online, the account, project and deposit invoice are created automatically."
      />
      <ProposalManager
        proposals={proposals}
        leads={leads.map((l) => ({
          ...l,
          estimatedValue: l.estimatedValue == null ? null : Number(l.estimatedValue),
        }))}
      />
    </div>
  );
}
