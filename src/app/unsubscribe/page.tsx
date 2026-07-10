import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/marketing-token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe — Avix Digital" };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const userId = token ? verifyUnsubscribeToken(token) : null;

  let ok = false;
  if (userId) {
    const result = await prisma.user.updateMany({
      where: { id: userId },
      data: { marketingOptOut: true },
    });
    ok = result.count > 0;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        <p className="font-heading text-xl font-bold text-slate-900">
          {ok ? "You're unsubscribed" : "This link isn't valid"}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {ok
            ? "You won't receive marketing emails from Avix Digital anymore. Emails about your projects and invoices are unaffected."
            : "The unsubscribe link is invalid or incomplete. If you keep receiving unwanted emails, reply to any of them and we'll remove you manually."}
        </p>
        <a
          href="https://avixdigital.com"
          className="mt-6 inline-block text-sm font-medium text-[#F65D0B] hover:underline"
        >
          avixdigital.com
        </a>
      </div>
    </div>
  );
}
