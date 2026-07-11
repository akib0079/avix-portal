import { requireAdmin } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { AppShell } from "@/components/layout/app-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, branding] = await Promise.all([requireAdmin(), getBranding()]);
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
