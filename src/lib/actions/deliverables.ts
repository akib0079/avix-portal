"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
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
