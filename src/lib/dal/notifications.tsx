import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import AdminAlertEmail from "@/emails/admin-alert";

export async function getNotificationsForUser(userId: string) {
  const [unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  return { unreadCount, notifications };
}

/**
 * Which admin notifications are worth an email as well as a bell row.
 *
 * The bell is free and can carry everything; an inbox cannot. These three are
 * the ones where a delay costs something real — money won, money claimed, and
 * a meeting you are expected to attend. Milestone approvals, thumbs ratings,
 * deliverable reviews and generated retainer drafts stay in-app: they are
 * routine project churn, and mailing every one of them trains you to ignore
 * the whole channel.
 *
 * TASK_REQUEST_SUBMITTED is absent on purpose — it already sends its own
 * bespoke email from src/lib/actions/task-requests.tsx, and adding it here
 * would deliver two messages for one event.
 *
 * Edit this set to change what lands in the inbox; nothing else needs touching.
 */
const EMAILED_TYPES = new Set([
  "PROPOSAL_ACCEPTED",
  "PAYMENT_CLAIMED",
  "MEETING_SCHEDULED",
]);

export async function notifyAllAdmins(input: {
  type:
    | "TASK_REQUEST_SUBMITTED"
    | "MILESTONE_APPROVED"
    | "MILESTONE_UPDATED"
    | "MEETING_SCHEDULED"
    | "DELIVERABLE_REVIEWED"
    | "PAYMENT_CLAIMED"
    | "RETAINER_GENERATED"
    | "PROPOSAL_ACCEPTED";
  title: string;
  body?: string;
  link?: string;
}) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((admin) => ({ userId: admin.id, ...input })),
  });

  // Best-effort: the mutation that triggered this has already committed, so a
  // mail failure must not surface as a failed action. sendEmail logs its own
  // errors; the catch is for a thrown transport fault.
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail || !EMAILED_TYPES.has(input.type)) return;
  try {
    await sendEmail({
      to: adminEmail,
      subject: input.title,
      react: (
        <AdminAlertEmail
          title={input.title}
          body={input.body}
          actionUrl={`${appUrl()}${input.link ?? "/admin"}`}
        />
      ),
      devHint: `admin alert (${input.type}) -> ${adminEmail}`,
    });
  } catch (err) {
    console.error("[notify] admin email failed:", (err as Error).message);
  }
}
