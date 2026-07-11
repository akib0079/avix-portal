import { requireClient } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { AppShell } from "@/components/layout/app-shell";

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
      {children}
    </AppShell>
  );
}
