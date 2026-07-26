import { requireClient } from "@/lib/dal/session";
import { getClientActionItems } from "@/lib/dal/portal-actions";
import { PageHeader } from "@/components/page-header";
import { ActionCenter } from "@/components/portal/action-center";

export const metadata = { title: "Action Center" };

export default async function ActionCenterPage() {
  const user = await requireClient();
  const items = await getClientActionItems(user.id);

  return (
    <div>
      <PageHeader
        title="Action Center"
        description="Everything waiting on you — approvals and invoices to pay, in one place."
      />
      <ActionCenter items={items} />
    </div>
  );
}
