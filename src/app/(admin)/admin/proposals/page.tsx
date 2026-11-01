import { getProposalCard, listProposalBoard } from "@/lib/dal/proposals";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { serverNow } from "@/lib/server-now";
import { PageHeader } from "@/components/page-header";
import { ProposalManager } from "@/components/proposals/proposal-manager";

export const metadata = { title: "Proposals" };

/** ?closed= — how far back the closed lanes reach: 90 days, a year, or everything. */
function closedWindow(value: string | undefined): number | null {
  if (value === "all") return null;
  if (value === "365") return 365;
  return 90;
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; closed?: string; id?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const archived = params.archived === "1";
  const closedDays = closedWindow(params.closed);

  const [board, leads, linked] = await Promise.all([
    listProposalBoard({ archived, closedDays }),
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
    // A deep link (?id=) may point at a proposal the board didn't load.
    params.id ? getProposalCard(params.id) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Send a scope and price. When they accept online, the account, project and first invoice are set up automatically."
      />
      <ProposalManager
        board={board}
        archived={archived}
        linked={linked}
        now={serverNow()}
        leads={leads.map((l) => ({
          ...l,
          estimatedValue: l.estimatedValue == null ? null : Number(l.estimatedValue),
        }))}
      />
    </div>
  );
}
