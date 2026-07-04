export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Apply persistent secrets before anything reads process.env (durable env
  // on hosts whose launcher injects stale values). Safe no-op locally.
  await import("@/lib/load-persistent-env");

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[bootstrap] SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin seed.");
    return;
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (existing) return;

    const { createUserWithPassword } = await import("@/lib/auth-utils");
    await createUserWithPassword({
      email,
      password,
      firstName: "Akib",
      lastName: "Zawayed",
      role: "ADMIN",
      company: "Avix Digital",
      emailVerified: true,
    });
    console.log(`[bootstrap] Super admin created: ${email}`);
  } catch (err) {
    console.warn("[bootstrap] admin seed skipped:", (err as Error).message);
  }
}
