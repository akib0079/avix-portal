"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal/session";
import { messageSchema, type MessageInput } from "@/lib/validation/message";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { sendEmail } from "@/lib/email/resend";
import MessageReceivedEmail from "@/emails/message-received";
import { appUrl } from "@/lib/app-url";
import type { Prisma } from "@prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Flattens Tiptap JSON to a short plain-text preview. */
function toPreview(doc: unknown, max = 140): string {
  const parts: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (node.text) parts.push(node.text);
    if (Array.isArray(node.content))
      node.content.forEach((c) => walk(c as { text?: string; content?: unknown[] }));
  };
  walk((doc as { content?: unknown[] }) ?? {});
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "(no text)";
}

/**
 * Posts into a thread. A thread is (clientId, projectId); projectId null is the
 * client's general thread. Clients may only post to their own threads; admins
 * must name the client (and, for a project thread, a project that client owns).
 */
export async function sendMessage(input: MessageInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid message." };
  if (!hasRichTextContent(parsed.data.body)) {
    return { ok: false, error: "Write a message first." };
  }

  const isAdmin = user.role === "ADMIN";
  const projectId = parsed.data.projectId ?? null;

  // Resolve + authorize the thread owner (the client).
  const clientId = isAdmin ? parsed.data.clientId : user.id;
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

  const senderRole = isAdmin ? "ADMIN" : "CLIENT";
  const now = new Date();

  await prisma.message.create({
    data: {
      clientId: client.id,
      projectId,
      senderId: user.id,
      senderRole,
      body: parsed.data.body as Prisma.InputJsonValue,
      // The sender has implicitly read their own message.
      readByAdminAt: senderRole === "ADMIN" ? now : null,
      readByClientAt: senderRole === "CLIENT" ? now : null,
    },
  });

  const preview = toPreview(parsed.data.body);
  const where = projectName ?? "General chat";
  const adminLink = projectId
    ? `/admin/projects/${projectId}`
    : `/admin/messages?client=${client.id}`;
  const clientLink = projectId ? `/portal/projects/${projectId}` : `/portal/messages`;

  if (senderRole === "CLIENT") {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
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
  return { ok: true };
}
