import { requireClient } from "@/lib/dal/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireClient();
  return (
    <AppShell variant="client" user={{ name: user.name, email: user.email }}>
      {children}
    </AppShell>
  );
}
