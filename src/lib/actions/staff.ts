"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { createUserWithPassword, sendPasswordLink } from "@/lib/auth-utils";
import { staffSchema, type StaffInput } from "@/lib/validation/staff";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Team management is ADMIN-only — staff can never create or modify accounts.
 * Staff are invited exactly like clients: a random password they never learn,
 * plus a set-your-password email.
 */

export async function createStaff(input: StaffInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "Someone with this email already exists." };

  await createUserWithPassword({
    email,
    password: randomBytes(24).toString("base64url"),
    firstName: data.firstName,
    lastName: data.lastName || "",
    role: "STAFF",
  });
  await sendPasswordLink(email);

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function setStaffStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<ActionResult> {
  await requireAdmin();
  const staff = await prisma.user.findFirst({ where: { id, role: "STAFF" } });
  if (!staff) return { ok: false, error: "Staff member not found." };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status } });
    if (status === "INACTIVE") {
      // Kill live sessions so revoking access takes effect immediately.
      await tx.session.deleteMany({ where: { userId: id } });
    }
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function resendStaffInvite(id: string): Promise<ActionResult> {
  await requireAdmin();
  const staff = await prisma.user.findFirst({ where: { id, role: "STAFF" } });
  if (!staff) return { ok: false, error: "Staff member not found." };
  await sendPasswordLink(staff.email);
  return { ok: true };
}

export async function deleteStaff(id: string): Promise<ActionResult> {
  await requireAdmin();
  const staff = await prisma.user.findFirst({
    where: { id, role: "STAFF" },
    include: { _count: { select: { messages: true } } },
  });
  if (!staff) return { ok: false, error: "Staff member not found." };
  if (staff._count.messages > 0) {
    return {
      ok: false,
      error:
        "This person has sent client messages. Deactivate them instead so the chat history stays intact.",
    };
  }
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/settings");
  return { ok: true };
}
