export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Apply persistent secrets before anything reads process.env (durable env
  // on hosts whose launcher injects stale values). Safe no-op locally.
  const { applyPersistentEnv } = await import("@/lib/load-persistent-env");
  applyPersistentEnv();

  const { prisma } = await import("@/lib/prisma");

  // Next waits for register() before serving the first request, so nothing
  // here may block on the database: with it in Tokyo, the two seed queries
  // below cost ~2 s on a cold connection, paid by whoever arrived first after
  // every process start. Warm the pool and run the seeds in the background.
  const warm = () =>
    Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]).catch(() => {});
  void warm();
  // Keep the connections warm between visits; unref so it never holds the
  // process open on shutdown.
  setInterval(warm, 4 * 60_000).unref();
  void seed(prisma);
}

type Db = (typeof import("@/lib/prisma"))["prisma"];

/** One-time bootstrap rows. Idempotent; runs in the background on boot. */
async function seed(prisma: Db) {
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
