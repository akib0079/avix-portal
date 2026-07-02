import { requireAdmin } from "@/lib/dal/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return (
    <AppShell variant="admin" user={{ name: user.name, email: user.email }}>
      {children}
    </AppShell>
  );
}
