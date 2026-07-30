import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { LeadSource, LeadStage, ProjectStatus } from "@prisma/client";
import { leadStageLabels } from "@/lib/validation/lead";

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
        orderBy: { email: "asc" },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, company: true },
          },
          lead: { select: { id: true, name: true, email: true, company: true } },
        },
      },
    },
  });
}

export type AudienceKind = "clients" | "leads" | "both";

export type AudienceFilter = {
  audience?: AudienceKind;
  search?: string;
  stages?: LeadStage[];
  sources?: LeadSource[];
  hasActiveProject?: boolean;
};

/** One mailable person, from either side of the house. */
export type AudienceEntry = {
  /** Stable composite key the composer round-trips: "client:<id>" / "lead:<id>". */
  key: string;
  kind: "client" | "lead";
  id: string;
  email: string;
  name: string;
  firstName: string;
  company: string | null;
  /** Short right-hand hint — client status or lead stage. */
  meta: string;
  /** Lead-only, for the composer's filters. */
  stage?: LeadStage;
  source?: LeadSource;
  hasActiveProject?: boolean;
};

const activeProjectStatuses: ProjectStatus[] = ["PLANNING", "IN_PROGRESS", "REVIEW"];

/**
 * The mailable audience: ACTIVE clients who haven't opted out, plus leads that
 * have an address and haven't opted out. Filters are applied in SQL so the
 * composer's "select all" always matches what the server would resolve.
 */
export async function listAudience(filter: AudienceFilter = {}): Promise<AudienceEntry[]> {
  await requireAdmin();
  const audience = filter.audience ?? "both";
  const search = filter.search?.trim();
  const entries: AudienceEntry[] = [];

  if (audience !== "leads") {
    const clients = await prisma.user.findMany({
      where: {
        role: "CLIENT",
        status: "ACTIVE",
        marketingOptOut: false,
        ...(filter.hasActiveProject
          ? { projects: { some: { status: { in: activeProjectStatuses } } } }
          : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: "insensitive" as const } },
                { lastName: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { company: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        company: true,
        _count: { select: { projects: { where: { status: { in: activeProjectStatuses } } } } },
      },
    });
    entries.push(
      ...clients.map((c) => ({
        key: `client:${c.id}`,
        kind: "client" as const,
        id: c.id,
        email: c.email,
        name: `${c.firstName} ${c.lastName}`.trim() || c.email,
        firstName: c.firstName,
        company: c.company,
        meta: "Client",
        hasActiveProject: c._count.projects > 0,
      })),
    );
  }

  if (audience !== "clients") {
    const leads = await prisma.lead.findMany({
      where: {
        email: { not: null },
        marketingOptOut: false,
        // Won leads are clients now; lost ones shouldn't be mailed by default.
        stage: filter.stages?.length
          ? { in: filter.stages }
          : { notIn: ["WON", "LOST"] as LeadStage[] },
        ...(filter.sources?.length ? { source: { in: filter.sources } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { company: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        stage: true,
        source: true,
      },
    });
    entries.push(
      ...leads
        .filter((l) => l.email)
        .map((l) => ({
          key: `lead:${l.id}`,
          kind: "lead" as const,
          id: l.id,
          email: l.email!,
          name: l.name,
          firstName: l.name.split(" ")[0] ?? l.name,
          company: l.company,
          meta: leadStageLabels[l.stage],
          stage: l.stage,
          source: l.source,
        })),
    );
  }

  // One address, one entry — a converted lead shouldn't be mailed twice.
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listSegments() {
  await requireAdmin();
  return prisma.audienceSegment.findMany({ orderBy: { name: "asc" } });
}

