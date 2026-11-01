import Link from "next/link";
import { listMyTaskRequests } from "@/lib/dal/task-requests";
import { listMyProjectOptions } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { TaskRequestStatusBadge } from "@/components/status-badges";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { formatDate } from "@/lib/format";
import { COLUMN_BY_ID, workItemHref } from "@/lib/board";
import { MessageSquarePlus } from "lucide-react";

/** The note withdrawWorkItem leaves on a request the client took back. */
const WITHDRAWN = "Withdrawn by client";

export const metadata = { title: "Task Requests" };

export default async function MyRequestsPage() {
  const [requests, projects] = await Promise.all([
    listMyTaskRequests(),
    listMyProjectOptions(),
  ]);

  return (
    <div>
      <PageHeader
        title="Task Requests"
        description="Request extra work on your projects and track the status."
        action={<RequestFormDialog projects={projects} triggerLabel="New request" />}
      />

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MessageSquarePlus className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No requests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Need something extra on a project? Submit a request and we&apos;ll
            review it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <div key={request.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading font-semibold">{request.title}</h3>
                  <TaskRequestStatusBadge status={request.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(request.createdAt)}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                on{" "}
                <Link
                  href={`/portal/projects/${request.project.id}`}
                  className="font-medium hover:text-primary"
                >
                  {request.project.projectName}
                </Link>
              </p>

              <div className="mt-3 rounded-lg bg-muted/50 px-4 py-3">
                <RichTextViewer content={request.description} />
              </div>

              {request.status === "REJECTED" && request.adminNote === WITHDRAWN && (
                <p className="mt-3 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                  You withdrew this request.
                </p>
              )}
              {request.status === "REJECTED" && request.adminNote && request.adminNote !== WITHDRAWN && (
                <p className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-800 dark:text-red-300">
                  <span className="font-medium">Note from Avix Digital:</span>{" "}
                  {request.adminNote}
                </p>
              )}
              {request.status === "PENDING" && request.milestone && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Waiting for the team —{" "}
                  <Link
                    href={workItemHref(request.project.id, request.milestone.id, "CLIENT")}
                    className="font-medium text-primary hover:underline"
                  >
                    see it on your project board
                  </Link>
                  , where you can still change it.
                </p>
              )}
              {request.status === "APPROVED" && (
                <p className="mt-3 rounded-lg bg-success-tint px-4 py-2.5 text-sm text-success">
                  {request.milestone && !request.milestone.archivedAt ? (
                    <>
                      Accepted — it&apos;s now{" "}
                      <Link
                        href={workItemHref(request.project.id, request.milestone.id, "CLIENT")}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {COLUMN_BY_ID[request.milestone.stage].clientLabel}
                      </Link>{" "}
                      on your project board.
                    </>
                  ) : (
                    "Accepted — it was added to your project."
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
