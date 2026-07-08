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

export async function sendMessage(input: MessageInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid message." };
  }
  if (!hasRichTextContent(parsed.data.body)) {
    return { ok: false, error: "Write a message first." };
  }

  // Authorize project access by role.
  const project = await prisma.project.findFirst({
    where:
      user.role === "ADMIN"
        ? { id: parsed.data.projectId }
        : { id: parsed.data.projectId, clientId: user.id },
    select: {
      id: true,
      projectName: true,
      clientId: true,
      client: { select: { id: true, firstName: true, email: true, status: true } },
    },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const senderRole = user.role === "ADMIN" ? "ADMIN" : "CLIENT";
  const now = new Date();

  await prisma.message.create({
    data: {
      projectId: project.id,
      senderId: user.id,
      senderRole,
      body: parsed.data.body as Prisma.InputJsonValue,
      // The sender has implicitly read their own message.
      readByAdminAt: senderRole === "ADMIN" ? now : null,
      readByClientAt: senderRole === "CLIENT" ? now : null,
    },
  });

  const preview = toPreview(parsed.data.body);

  if (senderRole === "CLIENT") {
    // Notify every admin.
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, email: true, firstName: true },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: "MESSAGE_RECEIVED" as const,
          title: `New message from ${user.name}`,
          body: `${project.projectName}: ${preview}`,
          link: `/admin/projects/${project.id}`,
        })),
      });
    }
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (adminEmail) {
      await sendEmail({
        to: adminEmail,
        subject: `New message on ${project.projectName}`,
        react: (
          <MessageReceivedEmail
            recipientFirstName="there"
            senderName={user.name}
            projectName={project.projectName}
            preview={preview}
            url={`${appUrl()}/admin/projects/${project.id}`}
          />
        ),
        devHint: `message → ${adminEmail}`,
      });
    }
  } else if (project.client && project.client.status === "ACTIVE") {
    // Admin → notify the client.
    await prisma.notification.create({
      data: {
        userId: project.client.id,
        type: "MESSAGE_RECEIVED",
        title: `New message from Avix Digital`,
        body: `${project.projectName}: ${preview}`,
        link: `/portal/projects/${project.id}`,
      },
    });
    await sendEmail({
      to: project.client.email,
      subject: `New message on ${project.projectName}`,
      react: (
        <MessageReceivedEmail
          recipientFirstName={project.client.firstName || "there"}
          senderName="Avix Digital"
          projectName={project.projectName}
          preview={preview}
          url={`${appUrl()}/portal/projects/${project.id}`}
        />
      ),
      devHint: `message → ${project.client.email}`,
    });
  }

  revalidatePath(`/admin/projects/${project.id}`);
  revalidatePath(`/portal/projects/${project.id}`);
  return { ok: true };
}
