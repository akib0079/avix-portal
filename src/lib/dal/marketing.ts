import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function listTemplates() {
  await requireAdmin();
  return prisma.emailTemplate.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function listCampaigns() {
  await requireAdmin();
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });
  const sentCounts = await prisma.campaignRecipient.groupBy({
    by: ["campaignId"],
    where: { sentAt: { not: null } },
    _count: true,
  });
  const sentByCampaign = new Map(sentCounts.map((c) => [c.campaignId, c._count]));
  return campaigns.map((c) => ({
    ...c,
    sentCount: sentByCampaign.get(c.id) ?? 0,
  }));
}

export async function getCampaign(id: string) {
  await requireAdmin();
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      recipients: {
        orderBy: { user: { firstName: "asc" } },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, company: true },
          },
        },
      },
    },
  });
}

/** ACTIVE clients who haven't opted out of marketing. */
export async function listMarketingRecipients() {
  await requireAdmin();
  return prisma.user.findMany({
    where: { role: "CLIENT", status: "ACTIVE", marketingOptOut: false },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, email: true, company: true },
  });
}
