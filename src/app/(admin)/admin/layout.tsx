import { requireAdmin } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { AppShell } from "@/components/layout/app-shell";
import { runDueDuties } from "@/lib/duties";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, branding] = await Promise.all([requireAdmin(), getBranding()]);
  // Lazy cron: scheduled work (meeting reminders, retainer invoice drafts)
  // piggybacks on admin visits. Throttled internally; never throws.
  await runDueDuties();
  return (
    <AppShell
      variant="admin"
      user={{ name: user.name, email: user.email }}
      logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
    >
      {children}
    </AppShell>
  );
}
