import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

/**
 * Creates a user with a credential account (better-auth convention: the
 * scrypt hash lives on accounts.password with providerId "credential").
 * Used by the super-admin bootstrap and by admin "add client".
 */
export async function createUserWithPassword(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
  company?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
}) {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const email = input.email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: `${input.firstName} ${input.lastName}`.trim(),
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        company: input.company ?? null,
        phone: input.phone ?? null,
        emailVerified: input.emailVerified ?? false,
      },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      },
    });
    return user;
  });
}

/** Sends (or re-sends) the set-your-password invite / reset email. */
export async function sendPasswordLink(email: string) {
  await auth.api.requestPasswordReset({
    body: { email: email.trim().toLowerCase(), redirectTo: "/reset-password" },
  });
}
