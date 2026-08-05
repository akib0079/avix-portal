import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyProject, getMyProjectExtras, listMyProjectOptions } from "@/lib/dal/portal";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import { DeliverablesList } from "@/components/deliverables/deliverables-list";
import { getWhatsappSupportUrl } from "@/lib/dal/settings";
import { ClientProjectTimeline } from "@/components/projects/client-project-timeline";
import { ProjectNeedsYou } from "@/components/projects/project-needs-you";
import { ChatWidget } from "@/components/messages/chat-widget";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectStatusBadge, InvoiceStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { projectHealth, pendingWork } from "@/lib/project-health";
import { projectTypeLabels, formatDate, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarDays,
  BadgeDollarSign,
  CircleDot,
  CalendarClock,
  ReceiptText,
  AlertTriangle,
} from "lucide-react";
import { toneChip } from "@/lib/tone";

export const metadata = { title: "Project" };

export default async function MyProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, options, whatsappUrl] = await Promise.all([
    getMyProject(id),
    listMyProjectOptions(),
    getWhatsappSupportUrl(),
  ]);
  if (!project) notFound();
  // After ownership is confirmed above (getMyProject scopes to the session).
  const [messages, deliverables, extras] = await Promise.all([
    getProjectMessages(project.id),
    listByProject(project.id),
    getMyProjectExtras(project.id),
  ]);

  const milestones = project.milestones.map((m) => {
    const view = toMilestoneView(m);
    return {
      ...view,
      loggedHours: extras.loggedHoursByMilestone[m.id] ?? view.loggedHours,
    };
  });

  const health = projectHealth({
    milestones,
    status: project.status,
    dueDate: project.dueDate,
  });
  const pending = pendingWork({
    milestones,
    deliverables,
    invoices: extras.invoices,
  });

  return (
    <div>
      <Link
        href="/portal/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to My Projects
      </Link>

      {/* Hero — where the project stands, in one glance. */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold">{project.projectName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {projectTypeLabels[project.type]}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ProjectStatusBadge status={project.status} />
              <RequestFormDialog projects={options} defaultProjectId={project.id} />
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {health.done} of {health.total} milestones complete
              </span>
              <span className="font-medium">{health.percent}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${health.percent}%` }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {health.nextMilestone && project.status !== "COMPLETED" && (
              <span className="flex items-center gap-1.5">
                <CircleDot className="size-3.5 shrink-0 text-primary" />
                <span className="text-muted-foreground">Up next:</span>
                <span className="font-medium">{health.nextMilestone.title}</span>
              </span>
            )}
            {(project.startDate || project.dueDate) && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                {formatDate(project.startDate)} → {formatDate(project.dueDate)}
              </span>
            )}
            {health.dueLabel && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  health.tone === "bad"
                    ? toneChip.bad
                    : health.tone === "warn"
                      ? toneChip.warn
                      : toneChip.good,
                )}
              >
                {health.overdue && <AlertTriangle className="size-3" />}
                {health.dueLabel}
              </span>
            )}
            {project.billingType === "CONTRACT" && project.contractPrice != null && (
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <BadgeDollarSign className="size-3.5 shrink-0" />
                {usd.format(Number(project.contractPrice))} fixed contract
              </span>
            )}
          </div>

          {hasRichTextContent(project.description) && (
            <div className="mt-4 border-t pt-4">
              <RichTextViewer content={project.description} />
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectNeedsYou pending={pending} projectId={project.id} className="mb-6" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <div id="deliverables" className="scroll-mt-20">
            <DeliverablesList deliverables={deliverables} />
          </div>

          <Card id="timeline" className="scroll-mt-20">
            <CardContent className="pt-6">
              <h2 className="font-heading mb-6 text-lg font-semibold">Project timeline</h2>
              <ClientProjectTimeline
                milestones={milestones}
                billingType={project.billingType}
              />
            </CardContent>
          </Card>
        </div>

        {/* Side column: the money and the calls, without leaving the project. */}
        <div className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          {extras.meetings.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="font-heading mb-3 flex items-center gap-2 text-base font-semibold">
                  <CalendarClock className="size-4" /> Upcoming calls
                </h2>
                <ul className="space-y-2">
                  {extras.meetings.map((m) => (
                    <li key={m.id} className="rounded-lg border p-3">
                      <p className="text-sm font-medium">{m.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(m.startsAt).toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · {m.durationMins} min
                      </p>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/portal/book"
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Book another time →
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <h2 className="font-heading mb-3 flex items-center gap-2 text-base font-semibold">
                <ReceiptText className="size-4" /> Invoices
              </h2>
              {extras.invoices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No invoices for this project yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {extras.invoices.map((invoice) => (
                    <li key={invoice.id}>
                      <Link
                        href={`/portal/invoices/${invoice.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {invoice.invoiceNumber}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(invoice.issueDate)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-medium">
                            {usd.format(invoice.amount)}
                          </span>
                          <InvoiceStatusBadge
                            status={
                              invoice.status as Parameters<
                                typeof InvoiceStatusBadge
                              >[0]["status"]
                            }
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ChatWidget
        projectId={project.id}
        viewerRole="CLIENT"
        initialMessages={messages}
        title="Chat with Avix Digital"
        whatsappUrl={whatsappUrl}
      />
    </div>
  );
}
