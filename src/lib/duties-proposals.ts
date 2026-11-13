import "server-only";
import { prisma } from "@/lib/prisma";
import { proposalContact } from "@/lib/dal/proposals";
import { dueProposalReminder, PROPOSAL_REMINDER_DAYS, timeLeftText } from "@/lib/proposal-rules";
import { emailProposalReminder, proposalUrl } from "@/lib/proposal-mail";

/**
 * The proposal steps of the duties engine, called from runDueDuties() in
 * src/lib/duties.tsx on its 15-minute cadence: lapse sent proposals whose
 * link has run out, and send the polite reminders before that happens.
 *
 * Like every duty, both are idempotent: the expiry only moves rows still
 * SENT, and a reminder is claimed by stamping lastReminderAt before the email
 * goes, so a re-run (or an overlapping one) finds nothing left to do.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Emails per run; the rest wait 15 minutes rather than hold up a page load. */
const REMINDER_BATCH = 10;
/** Resend's rate limit, as the campaign drain respects it. */
const SEND_GAP_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Never throws: a proposal duty failing must not stop the others. */
export async function runProposalDuties(now: Date): Promise<void> {
  try {
    await expireLapsedProposals(now);
    await sendProposalReminders(now);
  } catch (err) {
    console.error("[duties] proposals failed:", (err as Error).message);
  }
}

/**
 * SENT proposals past their expiry become EXPIRED, each with an audit row.
 * One UPDATE … RETURNING, so only the rows this run actually changed get an
 * event, even when two runs overlap.
 */
async function expireLapsedProposals(now: Date): Promise<void> {
  const expired = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE proposals
    SET status = 'EXPIRED', "updatedAt" = ${now}::timestamp
    WHERE status = 'SENT'
      AND "archivedAt" IS NULL
      AND "expiresAt" < ${now}::timestamp
    RETURNING id`;
  if (expired.length === 0) return;
  await prisma.proposalEvent.createMany({
    data: expired.map((p) => ({ proposalId: p.id, type: "EXPIRED" as const, createdAt: now })),
  });
}

/**
 * "Still interested?" emails a few days before a link runs out, while the
 * proposal is unsigned and the owner hasn't switched them off. Which window
 * is due is decided by dueProposalReminder (proposal-rules.ts).
 */
async function sendProposalReminders(now: Date): Promise<void> {
  const horizon = new Date(now.getTime() + Math.max(...PROPOSAL_REMINDER_DAYS) * DAY_MS);
  const candidates = await prisma.proposal.findMany({
    where: {
      status: "SENT",
      archivedAt: null,
      remindersEnabled: true,
      sentAt: { not: null },
      expiresAt: { gt: now, lte: horizon },
    },
    orderBy: { expiresAt: "asc" },
    take: 50,
    select: {
      id: true,
      title: true,
      currency: true,
      expiresAt: true,
      sentAt: true,
      lastReminderAt: true,
      linkVersion: true,
      convertedClientId: true,
      recipientName: true,
      recipientEmail: true,
      recipientCompany: true,
      items: { select: { amount: true } },
      lead: { select: { name: true, email: true, company: true } },
    },
  });

  const due = candidates.flatMap((p) => {
    const reminder = dueProposalReminder(p, now);
    const contact = proposalContact(p);
    return reminder && contact.email && p.expiresAt
      ? [{ p, reminder, email: contact.email, name: contact.name, expiresAt: p.expiresAt }]
      : [];
  });
  // The account a sent proposal was provisioned for. Mailing the lead's newer
  // address would split the client in two, so shareProposal refuses it and
  // so does this. One read, and only when it can matter.
  const accountIds = [...new Set(due.flatMap(({ p }) => (p.convertedClientId ? [p.convertedClientId] : [])))];
  const accounts = accountIds.length
    ? new Map(
        (
          await prisma.user.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, email: true },
          })
        ).map((u) => [u.id, u.email]),
      )
    : new Map<string, string>();

  let sent = 0;
  for (const { p, reminder, email, name, expiresAt } of due) {
    if (sent >= REMINDER_BATCH) break;
    const account = p.convertedClientId ? accounts.get(p.convertedClientId) : undefined;
    if (account && account.toLowerCase() !== email.toLowerCase()) continue;

    // Paced before the claim, so each row is claimed right before its email.
    if (sent > 0) await sleep(SEND_GAP_MS);
    // Stamp first, and only if the row is still as it was read: a failed send
    // must not retry every 15 minutes, two runs must not both mail, and a
    // resend, extend, archive or pause since (each moves linkVersion, or the
    // fields here) must not get the old link mailed.
    const claimed = await prisma.proposal.updateMany({
      where: {
        id: p.id,
        status: "SENT",
        archivedAt: null,
        remindersEnabled: true,
        linkVersion: p.linkVersion,
        expiresAt,
        lastReminderAt: p.lastReminderAt,
      },
      data: { lastReminderAt: now },
    });
    if (claimed.count === 0) continue;

    sent++;
    await emailProposalReminder({
      to: email,
      recipientName: name,
      title: p.title,
      total: p.items.reduce((sum, i) => sum + Number(i.amount), 0),
      currency: p.currency,
      timeLeftText: timeLeftText(expiresAt, now),
      expiresAt,
      url: proposalUrl({ id: p.id, expiresAt, linkVersion: p.linkVersion }),
    });
    await prisma.proposalEvent.create({
      data: {
        proposalId: p.id,
        type: "REMINDED",
        createdAt: now,
        meta: { daysBefore: reminder.daysBefore },
      },
    });
  }
}
