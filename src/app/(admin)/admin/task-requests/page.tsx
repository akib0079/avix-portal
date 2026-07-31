import { listTaskRequests } from "@/lib/dal/task-requests";
import { PageHeader } from "@/components/page-header";
import { RequestBoard } from "@/components/task-requests/request-board";
import { serverNow } from "@/lib/server-now";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Task Requests" };

export default async function TaskRequestsPage() {
  await requireAdmin();
  const requests = await listTaskRequests();
  // Server-rendered timestamp: "waiting N days" must not drift per render.
  const renderedAt = serverNow();

  return (
    <div>
      <PageHeader
        title="Task Requests"
        description="What clients have asked for — approve with pricing or decline with a note."
      />

      <RequestBoard requests={requests} now={renderedAt} />
    </div>
  );
}
