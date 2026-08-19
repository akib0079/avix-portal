"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal/session";
import { messageSchema, type MessageInput } from "@/lib/validation/message";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { sendEmail } from "@/lib/email/resend";
import MessageReceivedEmail from "@/emails/message-received";
import { appUrl } from "@/lib/app-url";
import { clipPreview, richTextToPlain } from "@/lib/rich-text";
import type { MessageView } from "@/lib/dal/messages";
import type { Prisma } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Marks the other side's messages in a thread as read for the caller. Split
 * out of the polling GET so reading the thread stays side-effect free — the
 * client calls this when the thread is actually on screen.
 */
export async function markThreadRead(input: {
  clientId?: string;
  projectId?: string | null;
}): Promise<ActionResult> {
  const user = await requireUser();
  const isTeam = user.role === "ADMIN" || user.role === "STAFF";
  const clientId = isTeam ? input.clientId : user.id;
  if (!clientId) return { ok: false, error: "Missing client." };
  const projectId = input.projectId ?? null;

  // A project thread must belong to that client (blocks cross-client writes).
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, clientId },
      select: { id: true },
    });
    if (!project) return { ok: false, error: "Thread not found." };
  }

  const field = isTeam ? "readByAdminAt" : "readByClientAt";
  await prisma.message.updateMany({
    where: {
      clientId,
      projectId,
      [field]: null,
      // Only the other side's messages need marking.
      senderRole: isTeam ? "CLIENT" : "ADMIN",
    },
    data: { [field]: new Date() },
  });
  return { ok: true };
}

/** How long a thread stays "already notified" before we email again. */
const NOTIFY_QUIET_MINUTES = 30;

/**
 * True when we already told this recipient about this thread recently, or when
 * they were reading it moments ago. Five messages in a row used to mean five
 * emails and five notification rows.
 */
async function alreadyNotified(input: {
  recipientId: string;
  clientId: string;
  projectId: string | null;
  /** Which read-stamp proves the recipient is currently looking. */
  readField: "readByAdminAt" | "readByClientAt";
  /** The thread's own deep link — scopes the quiet window to this thread. */
  threadLink: string;
}): Promise<boolean> {
  const since = new Date(Date.now() - NOTIFY_QUIET_MINUTES * 60_000);

  const [recent, activeReader] = await Promise.all([
    prisma.notification.findFirst({
      where: {
        userId: input.recipientId,
        type: "MESSAGE_RECEIVED",
        // Scoped by thread. Without the link filter one client writing in
        // silences the email for every other client for half an hour — on a
        // single-client test that reads as "the quiet window works", and with
        // a full roster it reads as "messages go missing".
        link: input.threadLink,
        createdAt: { gte: since },
      },
      select: { id: true },
    }),
    // Someone who read this thread in the last few minutes is looking at it.
    prisma.message.findFirst({
      where: {
        clientId: input.clientId,
        projectId: input.projectId,
        [input.readField]: { gte: new Date(Date.now() - 5 * 60_000) },
      },
      select: { id: true },
    }),
  ]);

  return !!recent || !!activeReader;
}

/**
 * Posts into a thread. A thread is (clientId, projectId); projectId null is the
 * client's general thread. Clients may only post to their own threads; admins
 * must name the client (and, for a project thread, a project that client owns).
 */
export async function sendMessage(
  input: MessageInput,
): Promise<ActionResult<{ message: MessageView }>> {
  const user = await requireUser();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };
  if (!hasRichTextContent(parsed.data.body)) {
    return { ok: false, error: "Write a message first." };
  }

  // STAFF posts on the team side, with their real identity (senderId).
  const isTeam = user.role === "ADMIN" || user.role === "STAFF";
  const projectId = parsed.data.projectId ?? null;

  // Resolve + authorize the thread owner (the client).
  const clientId = isTeam ? parsed.data.clientId : user.id;
  if (!clientId) return { ok: false, error: "Pick a client to message." };

  const client = await prisma.user.findFirst({
    where: { id: clientId, role: "CLIENT" },
    select: { id: true, firstName: true, email: true, status: true, name: true },
  });
  if (!client) return { ok: false, error: "Client not found." };

  // A project thread must belong to that client (also blocks cross-client access).
  let projectName: string | null = null;
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, clientId: client.id },
      select: { id: true, projectName: true },
    });
    if (!project) return { ok: false, error: "Project not found." };
    projectName = project.projectName;
  }

  const senderRole = isTeam ? "ADMIN" : "CLIENT";
  const now = new Date();

  const bodyText = richTextToPlain(parsed.data.body);

  const created = await prisma.message.create({
    data: {
      clientId: client.id,
      projectId,
      senderId: user.id,
      senderRole,
      body: parsed.data.body as Prisma.InputJsonValue,
      bodyText,
      // Only the team can write internal notes; a client payload can't set it.
      visibility: isTeam && parsed.data.internal ? "INTERNAL" : "PUBLIC",
      // The sender has implicitly read their own message.
      readByAdminAt: senderRole === "ADMIN" ? now : null,
      readByClientAt: senderRole === "CLIENT" ? now : null,
    },
  });

  const preview = clipPreview(bodyText, 140);
  const where = projectName ?? "General chat";
  const adminLink = projectId
    ? `/admin/projects/${projectId}`
    : `/admin/messages?client=${client.id}`;
  const clientLink = projectId ? `/portal/projects/${projectId}` : `/portal/messages`;

  // An internal note is a team memo — nobody outside the team hears about it.
  if (created.visibility === "INTERNAL") {
    if (projectId) {
      revalidatePath(`/admin/projects/${projectId}`);
    }
    revalidatePath("/admin/messages");
    return {
      ok: true,
      data: {
        message: {
          id: created.id,
          senderId: user.id,
          senderRole,
          senderName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name,
          senderIsStaff: user.role === "STAFF",
          body: parsed.data.body as MessageView["body"],
          createdAt: created.createdAt.toISOString(),
          visibility: created.visibility,
          readByAdminAt: created.readByAdminAt?.toISOString() ?? null,
          readByClientAt: created.readByClientAt?.toISOString() ?? null,
        },
      },
    };
  }

  if (senderRole === "CLIENT") {
    // Client replies ping the whole team (admins + staff).
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "STAFF"] }, status: "ACTIVE" },
      select: { id: true },
    });
    // Ask BEFORE writing this message's own notification rows. alreadyNotified
    // looks for a MESSAGE_RECEIVED row for this admin inside the quiet window,
    // so creating one first means it always finds the row we just wrote, quiet
    // is always true, and the admin email below never sends — for any message,
    // ever. The client branch below already gets this order right.
    const quiet = admins[0]
      ? await alreadyNotified({
          recipientId: admins[0].id,
          clientId: client.id,
          projectId,
          readField: "readByAdminAt",
          threadLink: adminLink,
        })
      : false;
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: "MESSAGE_RECEIVED" as const,
          title: `New message from ${user.name}`,
          body: `${where}: ${preview}`,
          link: adminLink,
        })),
      });
    }
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (adminEmail && !quiet) {
      await sendEmail({
        to: adminEmail,
        subject: `New message — ${where}`,
        react: (
          <MessageReceivedEmail
            recipientFirstName="there"
            senderName={user.name}
            projectName={where}
            preview={preview}
            url={`${appUrl()}${adminLink}`}
          />
        ),
        devHint: `message → ${adminEmail}`,
      });
    }
  } else if (client.status === "ACTIVE") {
    const quiet = await alreadyNotified({
      recipientId: client.id,
      clientId: client.id,
      projectId,
      readField: "readByClientAt",
      threadLink: clientLink,
    });

    // Admin → notify the client. The in-app row is cheap; the email is not.
    await prisma.notification.create({
      data: {
        userId: client.id,
        type: "MESSAGE_RECEIVED",
        title: "New message from Avix Digital",
        body: `${where}: ${preview}`,
        link: clientLink,
      },
    });
    if (!quiet) await sendEmail({
      to: client.email,
      subject: `New message — ${where}`,
      react: (
        <MessageReceivedEmail
          recipientFirstName={client.firstName || "there"}
          senderName="Avix Digital"
          projectName={where}
          preview={preview}
          url={`${appUrl()}${clientLink}`}
        />
      ),
      devHint: `message → ${client.email}`,
    });
  }

  if (projectId) {
    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/portal/projects/${projectId}`);
  }
  revalidatePath("/admin/messages");
  revalidatePath("/portal/messages");

  // Handing the saved row back lets the composer swap its optimistic entry for
  // the real one, instead of waiting for the next poll.
  return {
    ok: true,
    data: {
      message: {
        id: created.id,
        senderId: user.id,
        senderRole,
        senderName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name,
        senderIsStaff: user.role === "STAFF",
        body: parsed.data.body as MessageView["body"],
        createdAt: created.createdAt.toISOString(),
        visibility: created.visibility,
        readByAdminAt: created.readByAdminAt?.toISOString() ?? null,
        readByClientAt: created.readByClientAt?.toISOString() ?? null,
      },
    },
  };
}
