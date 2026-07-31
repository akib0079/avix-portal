import { after } from "next/server";
import { requireTeam } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { AppShell } from "@/components/layout/app-shell";
import { runDueDuties } from "@/lib/duties";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ADMIN or STAFF may enter the shell; every page and DAL call inside still
  // enforces its own role, so staff only reach the staff-safe surface.
  const [user, branding] = await Promise.all([requireTeam(), getBranding()]);
  // Lazy cron: scheduled work (meeting reminders, retainer invoices, campaign
  // sends, overdue chasing) piggybacks on ADMIN visits only — a staff page load
  // must never generate invoices.
  //
  // after() runs it once the response has been flushed. Awaiting it here made
  // one page load every 15 minutes wait for the whole batch — a campaign drain
  // alone is 25 emails at 600ms apart, so the page sat there for ~15 seconds.
  if (user.role === "ADMIN") after(() => runDueDuties());
  return (
    <AppShell
      variant="admin"
      role={user.role as "ADMIN" | "STAFF"}
      user={{ name: user.name, email: user.email }}
      logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
    >
      {children}
    </AppShell>
  );
}
