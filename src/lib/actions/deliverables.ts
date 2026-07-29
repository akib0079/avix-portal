"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireClient } from "@/lib/dal/session";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";
import { deliverableSchema } from "@/lib/validation/deliverable";
import { saveUpload, deleteUpload } from "@/lib/uploads";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Post a deliverable to a project — either an uploaded PDF/image or an external
 * link (Figma/Drive/etc). Notifies the project's client. Admin-only (STAFF are
 * money-blind but also excluded here to keep client-facing posts admin-owned).
 */
export async function createDeliverable(
  projectId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();

  const parsed = deliverableSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    externalUrl: String(formData.get("externalUrl") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { title, externalUrl } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectName: true, clientId: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  // Link or upload — exactly one is required.
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const link = externalUrl?.trim();
  if (!hasFile && !link) {
    return { ok: false, error: "Attach a file or paste a link." };
  }

  let filePath: string | null = null;
  let fileOriginalName: string | null = null;
  if (hasFile) {
    const saved = await saveUpload("deliverables", file as File);
    if (!saved.ok) return { ok: false, error: saved.error };
    filePath = saved.fileName;
    fileOriginalName = (file as File).name.slice(0, 255);
  }

  const deliverable = await prisma.deliverable.create({
    data: {
      projectId: project.id,
      title,
      filePath,
      fileOriginalName,
      // A file wins over a link if somehow both arrive.
      externalUrl: hasFile ? null : link || null,
    },
    select: { id: true },
  });

  // Let the client know something's ready. Best-effort — never block the post.
  if (project.clientId) {
    await prisma.notification
      .create({
        data: {
          userId: project.clientId,
          type: "DELIVERABLE_POSTED",
          title: `New deliverable: ${title}`,
          body: project.projectName,
          link: `/portal/projects/${project.id}`,
        },
      })
      .catch(() => {});
  }

  revalidatePath(`/admin/projects/${project.id}`);
  revalidatePath(`/portal/projects/${project.id}`);
  return { ok: true, data: { id: deliverable.id } };
}

/**
 * The client approves a deliverable or asks for changes. Scoped to their own
 * projects; notifies the admins so the feedback loop closes where the work is.
 */
export async function reviewDeliverable(
  id: string,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  note?: string,
): Promise<ActionResult> {
  const user = await requireClient();
  if (decision !== "APPROVED" && decision !== "CHANGES_REQUESTED") {
    return { ok: false, error: "Invalid decision." };
  }

  const deliverable = await prisma.deliverable.findFirst({
    where: { id, project: { clientId: user.id } },
    select: {
      id: true,
      title: true,
      project: { select: { id: true, projectName: true } },
    },
  });
  if (!deliverable) return { ok: false, error: "Deliverable not found." };

  const trimmed = note?.trim().slice(0, 1000) || null;
  if (decision === "CHANGES_REQUESTED" && !trimmed) {
    return { ok: false, error: "Tell us what needs changing." };
  }

  await prisma.deliverable.update({
    where: { id },
    data: { reviewStatus: decision, reviewNote: trimmed, reviewedAt: new Date() },
  });

  const approved = decision === "APPROVED";
  await notifyAllAdmins({
    type: "DELIVERABLE_REVIEWED",
    title: `${user.firstName || "Client"} ${approved ? "approved" : "requested changes on"}: ${deliverable.title}`,
    body: trimmed ? `“${trimmed}”` : deliverable.project.projectName,
    link: `/admin/projects/${deliverable.project.id}`,
  });
  await logActivity({
    type: approved ? "deliverable.approved" : "deliverable.changes",
    summary: `${user.firstName || "Client"} ${approved ? "approved" : "requested changes on"} “${deliverable.title}”`,
    actorId: user.id,
    clientId: user.id,
    entity: "project",
    entityId: deliverable.project.id,
    link: `/admin/projects/${deliverable.project.id}`,
  });

  revalidatePath(`/portal/projects/${deliverable.project.id}`);
  revalidatePath(`/admin/projects/${deliverable.project.id}`);
  return { ok: true };
}

export async function deleteDeliverable(id: string): Promise<ActionResult> {
  await requireAdmin();

  const deliverable = await prisma.deliverable.findUnique({
    where: { id },
    select: { id: true, projectId: true, filePath: true },
  });
  if (!deliverable) return { ok: false, error: "Deliverable not found." };

  await prisma.deliverable.delete({ where: { id } });
  if (deliverable.filePath) await deleteUpload("deliverables", deliverable.filePath);

  revalidatePath(`/admin/projects/${deliverable.projectId}`);
  revalidatePath(`/portal/projects/${deliverable.projectId}`);
  return { ok: true };
}
