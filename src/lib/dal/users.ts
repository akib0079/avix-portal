import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireTeam } from "@/lib/dal/session";
import { usdValue } from "@/lib/invoice-usd";

export type ClientHealth = "green" | "amber" | "red";

/**
 * Relationship health per client:
 *  red   — an unpaid invoice more than 7 days overdue
 *  amber — any overdue invoice, or an active project with no messages
 *          either way in 21+ days (relationship going quiet)
 *  Cancelled invoices are never overdue.
 *  green — everything current
 */
export async function listClients() {
  await requireAdmin();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const staleCutoff = new Date(now.getTime() - 21 * 86_400_000);

  const [clients, openInvoices, activeProjects, lastMessages] = await Promise.all([
    prisma.user.findMany({
      where: { role: "CLIENT" },
      orderBy: { createdAt: "desc" },
      // Bounded — the table is client-side filtered, so this is the ceiling.
      take: 300,
      include: { _count: { select: { projects: true, invoices: true } } },
    }),
    // Everything still owed. CANCELLED is not owed: it used to count here, so
    // a voided invoice past its due date turned the client red for good.
    prisma.invoice.findMany({
      where: { status: { notIn: ["PAID", "CANCELLED"] } },
      select: {
        clientId: true,
        dueDate: true,
        amount: true,
        amountPaid: true,
        currency: true,
        amountUsd: true,
      },
    }),
    prisma.project.findMany({
      where: { status: { in: ["IN_PROGRESS", "REVIEW"] }, clientId: { not: null } },
      select: { clientId: true },
    }),
    // Last message either way, per client — one grouped read.
    prisma.message.groupBy({ by: ["clientId"], _max: { createdAt: true } }),
  ]);

  const badlyOverdue = new Set<string>();
  const anyOverdue = new Set<string>();
  const owed = new Map<string, { usd: number; missing: number }>();
  for (const inv of openInvoices) {
    if (inv.dueDate && inv.dueDate < now) {
      anyOverdue.add(inv.clientId);
      if (inv.dueDate < sevenDaysAgo) badlyOverdue.add(inv.clientId);
    }
    const amount = Number(inv.amount);
    const balance = Math.max(amount - Number(inv.amountPaid), 0);
    if (balance <= 0) continue;
    const entry = owed.get(inv.clientId) ?? { usd: 0, missing: 0 };
    // In USD at the invoice's own recorded value — EUR 1,400 is not $1,400.
    const worth = usdValue({
      amount,
      currency: inv.currency,
      amountUsd: inv.amountUsd == null ? null : Number(inv.amountUsd),
    });
    if (worth === null || amount <= 0) entry.missing++;
    else entry.usd += balance * (worth / amount);
    owed.set(inv.clientId, entry);
  }

  const liveProjects = new Map<string, number>();
  for (const p of activeProjects) {
    liveProjects.set(p.clientId!, (liveProjects.get(p.clientId!) ?? 0) + 1);
  }
  const lastContact = new Map(lastMessages.map((m) => [m.clientId, m._max.createdAt]));

  return clients.map((client) => {
    const last = lastContact.get(client.id) ?? null;
    const quiet = !last || last < staleCutoff;
    const live = liveProjects.get(client.id) ?? 0;

    let health: ClientHealth = "green";
    let healthReason: string | null = null;
    if (badlyOverdue.has(client.id)) {
      health = "red";
      healthReason = "Invoice 7+ days overdue";
    } else if (anyOverdue.has(client.id)) {
      health = "amber";
      healthReason = "Invoice overdue";
    } else if (live > 0 && quiet) {
      health = "amber";
      healthReason = "Live project, quiet for 3+ weeks";
    }

    const balance = owed.get(client.id);
    return {
      ...client,
      health,
      healthReason,
      liveProjects: live,
      owedUsd: Math.round((balance?.usd ?? 0) * 100) / 100,
      /** Open balances with no USD value yet — not in owedUsd. */
      owedUnconverted: balance?.missing ?? 0,
      lastContactAt: last,
    };
  });
}

export async function getClient(id: string) {
  await requireAdmin();
  return prisma.user.findFirst({
    where: { id, role: "CLIENT" },
    include: {
      projects: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listActiveClientOptions() {
  await requireAdmin();
  return prisma.user.findMany({
    where: { role: "CLIENT", status: "ACTIVE" },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, company: true },
  });
}

/** Team members (STAFF). Admin-only — used by Settings → Team. */
export async function listStaff() {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    where: { role: "STAFF" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });
  return rows.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    status: u.status,
    emailVerified: u.emailVerified,
    messageCount: u._count.messages,
  }));
}

export type TeamOption = { id: string; name: string; role: "ADMIN" | "STAFF" };

/**
 * Everyone who can be assigned work — admins and staff, active only.
 * requireTeam (not requireAdmin) so staff can reassign their own milestones.
 */
export async function listTeamOptions(): Promise<TeamOption[]> {
  await requireTeam();
  const rows = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "STAFF"] }, status: "ACTIVE" },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
  });
  return rows.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim() || u.email,
    role: u.role as "ADMIN" | "STAFF",
  }));
}

export type ClientSnapshot = Awaited<ReturnType<typeof getClientSnapshot>>;

/**
 * The numbers a client hub leads with: money in and owed, how the work is
 * going, how happy they are, and when we last spoke. All bounded queries —
 * this is a header, not a report.
 */
export async function getClientSnapshot(clientId: string) {
  await requireAdmin();
  const now = new Date();

  const [invoices, projects, ratings, lastMessage, openRequests, nextMeeting] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { clientId, status: { not: "CANCELLED" }, creditNoteForId: null },
        select: { amount: true, amountPaid: true, dueDate: true, status: true },
      }),
      prisma.project.findMany({
        where: { clientId },
        select: { id: true, status: true },
      }),
      prisma.milestone.findMany({
        where: { project: { clientId }, clientRating: { not: null } },
        select: { clientRating: true },
      }),
      prisma.message.findFirst({
        where: { clientId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, senderRole: true },
      }),
      prisma.taskRequest.count({ where: { clientId, status: "PENDING" } }),
      prisma.meeting.findFirst({
        where: { clientId, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        select: { id: true, title: true, startsAt: true },
      }),
    ]);

  const billed = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const collected = invoices.reduce((sum, i) => sum + Number(i.amountPaid), 0);
  const outstanding = Math.max(billed - collected, 0);
  const overdue = invoices
    .filter((i) => i.dueDate && i.dueDate < now && Number(i.amountPaid) < Number(i.amount))
    .reduce((sum, i) => sum + (Number(i.amount) - Number(i.amountPaid)), 0);

  const thumbsUp = ratings.filter((r) => r.clientRating === 1).length;

  return {
    billed: Math.round(billed * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    outstanding: Math.round(outstanding * 100) / 100,
    overdue: Math.round(overdue * 100) / 100,
    activeProjects: projects.filter((p) => p.status !== "COMPLETED").length,
    totalProjects: projects.length,
    /** Share of rated milestones that got a 👍, or null when nothing is rated. */
    satisfaction: ratings.length === 0 ? null : Math.round((thumbsUp / ratings.length) * 100),
    ratedCount: ratings.length,
    lastContactAt: lastMessage?.createdAt.toISOString() ?? null,
    lastContactFromClient: lastMessage?.senderRole === "CLIENT",
    openRequests,
    nextMeeting: nextMeeting
      ? {
          id: nextMeeting.id,
          title: nextMeeting.title,
          startsAt: nextMeeting.startsAt.toISOString(),
        }
      : null,
  };
}
