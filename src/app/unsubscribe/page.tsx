import { redirect } from "next/navigation";
import { applyUnsubscribe } from "@/lib/unsubscribe";
import { verifyUnsubscribeToken } from "@/lib/marketing-token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe — Avix Digital" };

/**
 * Confirm-then-POST. A plain GET here used to opt someone out, which means a
 * mail scanner or link prefetcher could unsubscribe them without their ever
 * clicking. The GET now only asks; the action does the write.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { token, done } = await searchParams;
  const valid = token ? verifyUnsubscribeToken(token) !== null : false;
  const finished = done === "1";

  async function confirm(formData: FormData) {
    "use server";
    const value = String(formData.get("token") ?? "");
    const ok = await applyUnsubscribe(value);
    redirect(ok ? `/unsubscribe?token=${value}&done=1` : "/unsubscribe");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <p className="font-heading text-xl font-bold text-foreground">
          {finished
            ? "You're unsubscribed"
            : valid
              ? "Unsubscribe from marketing emails?"
              : "This link isn't valid"}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {finished
            ? "You won't receive marketing emails from Avix Digital anymore. Emails about your projects and invoices are unaffected."
            : valid
              ? "Confirm and we'll stop sending you marketing email. Emails about your projects and invoices are unaffected."
              : "The unsubscribe link is invalid or incomplete. If you keep receiving unwanted emails, reply to any of them and we'll remove you manually."}
        </p>

        {valid && !finished && (
          <form action={confirm} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="w-full rounded-full bg-[#F65D0B] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Yes, unsubscribe me
            </button>
          </form>
        )}

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
