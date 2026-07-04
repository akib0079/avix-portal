export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Apply persistent secrets before anything reads process.env (durable env
  // on hosts whose launcher injects stale values). Safe no-op locally.
  const { applyPersistentEnv } = await import("@/lib/load-persistent-env");
  applyPersistentEnv();

  const { prisma } = await import("@/lib/prisma");

  // Seed the super admin (idempotent).
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    try {
      const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
      if (!existing) {
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
      }
    } catch (err) {
      console.warn("[bootstrap] admin seed skipped:", (err as Error).message);
    }
  } else {
    console.warn("[bootstrap] SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin seed.");
  }

  // Seed the default bank-transfer payment accounts once (idempotent).
  try {
    const count = await prisma.paymentAccount.count();
    if (count === 0) {
      const { defaultPaymentAccounts } = await import("@/lib/payment-defaults");
      await prisma.paymentAccount.createMany({
        data: defaultPaymentAccounts.map((a, index) => ({
          title: a.title,
          region: a.region,
          holderName: a.holderName,
          bankName: a.bankName,
          bankNote: a.bankNote,
          note: a.note,
          fields: a.fields,
          position: index,
        })),
      });
      console.log("[bootstrap] Seeded default payment accounts.");
    }
  } catch (err) {
    console.warn("[bootstrap] payment seed skipped:", (err as Error).message);
  }
}
