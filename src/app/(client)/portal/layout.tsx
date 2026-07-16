import { requireClient } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/layout/app-shell";
import { TimezoneSync } from "@/components/portal/timezone-sync";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, branding] = await Promise.all([requireClient(), getBranding()]);
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { timezone: true },
  });
  return (
    <AppShell
      variant="client"
      user={{ name: user.name, email: user.email }}
      logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
    >
      <TimezoneSync hasTimezone={!!record?.timezone} />
      {children}
    </AppShell>
  );
}
