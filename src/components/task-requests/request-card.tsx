import Link from "next/link";
import { TaskRequestStatusBadge } from "@/components/status-badges";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { RequestReviewActions } from "./request-review-actions";
import { formatDate } from "@/lib/format";
import type { TaskRequestStatus } from "@prisma/client";
import { CircleUser, FolderKanban } from "lucide-react";

export function RequestCard({
  request,
}: {
  request: {
    id: string;
    title: string;
    description: unknown;
    status: TaskRequestStatus;
    adminNote: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    client: { id: string; firstName: string; lastName: string; company: string | null };
    project: { id: string; projectName: string };
  };
}) {
  const clientName = `${request.client.firstName} ${request.client.lastName}`;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading font-semibold">{request.title}</h3>
            <TaskRequestStatusBadge status={request.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Link
              href={`/admin/clients/${request.client.id}`}
              className="flex items-center gap-1 hover:text-primary"
            >
              <CircleUser className="size-3.5" />
              {clientName}
              {request.client.company ? ` (${request.client.company})` : ""}
            </Link>
            <Link
              href={`/admin/projects/${request.project.id}`}
              className="flex items-center gap-1 hover:text-primary"
            >
              <FolderKanban className="size-3.5" />
              {request.project.projectName}
            </Link>
            <span>Submitted {formatDate(request.createdAt)}</span>
            {request.resolvedAt && <span>Resolved {formatDate(request.resolvedAt)}</span>}
          </div>
        </div>
        {request.status === "PENDING" && (
          <RequestReviewActions
            request={{ id: request.id, title: request.title, clientName }}
          />
        )}
      </div>

      <div className="mt-4 rounded-lg bg-muted/50 px-4 py-3">
        <RichTextViewer content={request.description} />
      </div>

      {request.status === "REJECTED" && request.adminNote && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <span className="font-medium">Rejection note:</span> {request.adminNote}
        </p>
      )}
    </div>
  );
}
