import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getBranding } from "@/lib/dal/settings";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/layout/app-shell";
import { TimezoneSync } from "@/components/portal/timezone-sync";

/**
 * Whether a timezone is stored only matters to a component that renders
 * nothing. Awaiting it in the layout held back the first byte of every portal
 * page by a database round trip; behind Suspense it streams in afterwards.
 */
async function TimezoneGate({ userId }: { userId: string }) {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return <TimezoneSync hasTimezone={!!record?.timezone} />;
}

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
      <Suspense fallback={null}>
        <TimezoneGate userId={user.id} />
      </Suspense>
      {children}
    </AppShell>
  );
}
