import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Add Client" };

export default async function NewClientPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add Client"
        description="Create a client account and send them a portal invite."
      />
      <Card>
        <CardContent className="pt-6">
          <ClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
