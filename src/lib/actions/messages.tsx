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

  if (senderRole === "CLIENT") {
    // Client replies ping the whole team (admins + staff).
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "STAFF"] }, status: "ACTIVE" },
      select: { id: true },
    });
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
    if (adminEmail) {
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
    // Admin → notify the client.
    await prisma.notification.create({
      data: {
        userId: client.id,
        type: "MESSAGE_RECEIVED",
        title: "New message from Avix Digital",
        body: `${where}: ${preview}`,
        link: clientLink,
      },
    });
    await sendEmail({
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
        readByAdminAt: created.readByAdminAt?.toISOString() ?? null,
        readByClientAt: created.readByClientAt?.toISOString() ?? null,
      },
    },
  };
}
