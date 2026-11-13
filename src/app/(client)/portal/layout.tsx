import { requireClient } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { AppShell } from "@/components/layout/app-shell";
import { TimezoneSync } from "@/components/portal/timezone-sync";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, branding] = await Promise.all([requireClient(), getBranding()]);
  return (
    <AppShell
      variant="client"
      user={{ name: user.name, email: user.email }}
      logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
    >
      {/* Sends the browser's zone once per device; no read on any render. */}
      <TimezoneSync userId={user.id} />
      {children}
    </AppShell>
  );
}
