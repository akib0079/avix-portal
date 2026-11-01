import { requireClient } from "@/lib/dal/session";
import { getClientActionItems } from "@/lib/dal/portal-actions";
import { listMyProjectOptions } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { ActionCenter } from "@/components/portal/action-center";

export const metadata = { title: "Action Center" };

export default async function ActionCenterPage() {
  const user = await requireClient();
  // One wave: the list, and the projects "Ask again" can send a request to.
  const [items, projects] = await Promise.all([getClientActionItems(user.id), listMyProjectOptions()]);

  return (
    <div>
      <PageHeader
        title="Action Center"
        description="Everything waiting on you — work to review, questions, files, ratings and invoices, each a click away."
      />
      <ActionCenter items={items} projects={projects} />
    </div>
  );
}
