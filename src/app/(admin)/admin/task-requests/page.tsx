import { listTaskRequests } from "@/lib/dal/task-requests";
import { PageHeader } from "@/components/page-header";
import { RequestBoard, type InboxRequest } from "@/components/task-requests/request-board";
import { requestOutcome } from "@/lib/work-list";
import { hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { serverNow } from "@/lib/server-now";
import { requireTeam } from "@/lib/dal/session";

export const metadata = { title: "Requests" };

/**
 * Every client's requests across every project. The same requests wait at
 * the top of each project's Milestones list; this is where the team sees
 * them all at once. Staff decide them too, at no charge — pricing is an
 * admin's (the accept action enforces it).
 */
export default async function TaskRequestsPage() {
  const [viewer, { waiting, decided }] = await Promise.all([requireTeam(), listTaskRequests()]);
  // Server-rendered timestamp: "waiting N days" must not drift per render.
  const renderedAt = serverNow();

  const requests: InboxRequest[] = [
    ...waiting.map((item) => ({
      requestId: item.sourceTaskRequest?.id ?? null,
      itemId: item.id,
      title: item.title,
      // The client's words, when they wrote any beyond the title.
      description: hasRichTextContent(item.sourceTaskRequest?.description)
        ? item.sourceTaskRequest?.description
        : undefined,
      client: item.sourceTaskRequest?.client ?? null,
      project: item.project,
      createdAt: item.createdAt.toISOString(),
      resolvedAt: null,
      outcome: { kind: "waiting" as const },
      comments: item._count.comments,
    })),
    ...decided.map((r) => ({
      requestId: r.id,
      itemId: r.milestone?.id ?? null,
      title: r.title,
      client: r.client,
      project: r.project,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      outcome: requestOutcome(r, r.milestone),
      comments: 0,
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Requests"
        description="What clients have asked for, across every project — accept each into the plan or decline it with a note."
      />

      <RequestBoard requests={requests} now={renderedAt} role={viewer.role === "ADMIN" ? "ADMIN" : "STAFF"} />
    </div>
  );
}
