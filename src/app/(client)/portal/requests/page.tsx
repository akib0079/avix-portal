import Link from "next/link";
import { listMyTaskRequests } from "@/lib/dal/task-requests";
import { listMyProjectOptions } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { SoftPill } from "@/components/ui/status-pill";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { formatDate } from "@/lib/format";
import { COLUMN_BY_ID, workItemHref } from "@/lib/board";
import { requestLabel, requestOutcome, type RequestOutcome } from "@/lib/work-list";
import { HUE } from "@/lib/status-colors";
import { ArrowRight, MessageSquarePlus } from "lucide-react";

export const metadata = { title: "My requests" };

/** The pill's hue: the stage an accepted request has reached, otherwise how it was decided. */
function outcomeColor(outcome: RequestOutcome): string {
  switch (outcome.kind) {
    case "waiting":
      return COLUMN_BY_ID.REQUESTED.color;
    case "accepted":
      return COLUMN_BY_ID[outcome.stage].color;
    case "declined":
      return HUE.red;
    default:
      return HUE.muted;
  }
}

/**
 * Everything the client has asked for, and where each one stands now — not
 * a frozen "approved", but the live stage of the work it became ("Accepted,
 * in progress"), or the team's reason for declining it. New requests start
 * here or from a project page; either way they wait for the team in that
 * project's Milestones.
 */
export default async function MyRequestsPage() {
  const [requests, projects] = await Promise.all([listMyTaskRequests(), listMyProjectOptions()]);

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Everything you've asked for, and where each one stands."
        action={<RequestFormDialog projects={projects} />}
      />

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MessageSquarePlus className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No requests yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Need something new on a project? Ask for it here — it waits for the team, who accept it into
            your milestones or get back to you.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const outcome = requestOutcome(request, request.milestone);
            const open =
              request.milestone && !request.milestone.archivedAt
                ? workItemHref(request.project.id, request.milestone.id, "CLIENT", "list")
                : null;
            return (
              <div key={request.id} className="rounded-xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="font-heading font-semibold [overflow-wrap:anywhere]">{request.title}</h3>
                    <SoftPill color={outcomeColor(outcome)}>{requestLabel(outcome, "CLIENT")}</SoftPill>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(request.createdAt)}</p>
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

                {hasRichTextContent(request.description) && (
                  <div className="mt-3 rounded-lg bg-muted/50 px-4 py-3">
                    <RichTextViewer content={request.description} />
                  </div>
                )}

                {outcome.kind === "declined" && outcome.note && (
                  <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    <span className="font-medium">Declined:</span> {outcome.note}
                  </p>
                )}
                {outcome.kind === "waiting" && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    The team hasn&apos;t decided yet. Until they do, you can still change it or withdraw it
                    from your project.
                  </p>
                )}
                {open && (outcome.kind === "waiting" || outcome.kind === "accepted") && (
                  <Link
                    href={open}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    {outcome.kind === "waiting" ? "Open your request" : "See it in your milestones"}
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
