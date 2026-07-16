"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { createUserWithPassword, sendPasswordLink } from "@/lib/auth-utils";
import { clientSchema, type ClientInput } from "@/lib/validation/client";
import { randomBytes } from "crypto";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createClient(input: ClientInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  // Throwaway password — never shown to anyone. The client sets their own
  // via the emailed invite link.
  await createUserWithPassword({
    email: data.email,
    password: randomBytes(24).toString("base64url"),
    firstName: data.firstName,
    lastName: data.lastName,
    role: "CLIENT",
    company: data.company || null,
    phone: data.phone || null,
  });
  await sendPasswordLink(data.email);

  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function updateClient(
  id: string,
  input: ClientInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const client = await prisma.user.findFirst({ where: { id, role: "CLIENT" } });
  if (!client) return { ok: false, error: "Client not found." };

  const emailTaken = await prisma.user.findFirst({
    where: { email: data.email.toLowerCase(), NOT: { id } },
  });
  if (emailTaken) return { ok: false, error: "That email is already in use." };

  // Validate the timezone against the runtime's IANA database.
  let timezone: string | null = data.timezone?.trim() || null;
  if (timezone) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      timezone = null;
    }
  }

  await prisma.user.update({
    where: { id },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`.trim(),
      email: data.email.toLowerCase(),
      company: data.company || null,
      phone: data.phone || null,
      timezone,
    },
  });

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${id}`);
  return { ok: true };
}

export async function setClientStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<ActionResult> {
  await requireAdmin();
  const client = await prisma.user.findFirst({ where: { id, role: "CLIENT" } });
  if (!client) return { ok: false, error: "Client not found." };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status } });
    if (status === "INACTIVE") {
      // Kill existing sessions so deactivation takes effect immediately.
      await tx.session.deleteMany({ where: { userId: id } });
    }
  });

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${id}`);
  return { ok: true };
}

export async function resendInvite(id: string): Promise<ActionResult> {
  await requireAdmin();
  const client = await prisma.user.findFirst({ where: { id, role: "CLIENT" } });
  if (!client) return { ok: false, error: "Client not found." };
  await sendPasswordLink(client.email);
  return { ok: true };
}

export async function deleteClient(id: string): Promise<ActionResult> {
  await requireAdmin();
  const client = await prisma.user.findFirst({
    where: { id, role: "CLIENT" },
    include: { _count: { select: { invoices: true } } },
  });
  if (!client) return { ok: false, error: "Client not found." };
  if (client._count.invoices > 0) {
    return {
      ok: false,
      error:
        "This client has invoices on record. Deactivate the account instead of deleting it.",
    };
  }
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/clients");
  return { ok: true };
}
