import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyProject, getMyProjectExtras, listMyProjectOptions } from "@/lib/dal/portal";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import { getBoardCards, getBoardPeople } from "@/lib/dal/project-board";
import { requireClient } from "@/lib/dal/session";
import { DeliverablesList } from "@/components/deliverables/deliverables-list";
import { getWhatsappSupportUrl } from "@/lib/dal/settings";
import { ClientProjectTimeline } from "@/components/projects/client-project-timeline";
import { ProjectNeedsYou } from "@/components/projects/project-needs-you";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectBoard } from "@/components/board/project-board";
import { ChatWidget } from "@/components/messages/chat-widget";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectStatusBadge, InvoiceStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { projectHealth, pendingWork } from "@/lib/project-health";
import { projectTypeLabels, formatDate, usd } from "@/lib/format";
import { formatCurrency } from "@/lib/currency";
import { serverNow } from "@/lib/server-now";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarDays,
  BadgeDollarSign,
  CircleDot,
  CalendarClock,
  ReceiptText,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { toneChip } from "@/lib/tone";

export const metadata = { title: "Project" };

export default async function MyProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const [{ id }, { task: taskParam }] = await Promise.all([params, searchParams]);
  // The board loads in the same wave as the ownership check. Its reads do no
  // check of their own; nothing they return is rendered unless getMyProject —
  // scoped to the session — found the project.
  const [user, project, options, whatsappUrl, cards, people] = await Promise.all([
    requireClient(),
    getMyProject(id),
    listMyProjectOptions(),
    getWhatsappSupportUrl(),
    getBoardCards(id),
    getBoardPeople(id),
  ]);
  if (!project) notFound();
  // Milestones are already on the project; the board doesn't fetch them again.
  const board = {
    cards,
    people,
    milestones: project.milestones.map((m) => ({ id: m.id, title: m.title })),
  };
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
  const boardWaiting = {
    review: board.cards.filter((c) => c.status === "REVIEW").length,
    help: board.cards.filter((c) => c.helpFrom === "ADMIN").length,
  };
  const openTasks = board.cards.filter((c) => c.status !== "DONE").length;
  const viewer = {
    id: user.id,
    side: "CLIENT" as const,
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name,
  };

  const tabs = [
    {
      value: "board",
      label: "Board",
      icon: "board" as const,
      count: openTasks,
      alert: boardWaiting.review + boardWaiting.help > 0,
      content: (
        <ProjectBoard
          projectId={project.id}
          viewer={viewer}
          initial={board}
          renderedAt={serverNow()}
          initialTaskId={taskParam ?? null}
        />
      ),
    },
    {
      value: "timeline",
      label: "Timeline",
      icon: "timeline" as const,
      count: milestones.length,
      alert: pending.milestonesAwaitingApproval + pending.milestonesAwaitingRating > 0,
      content: (
        <Card>
          <CardContent className="pt-6">
            <ClientProjectTimeline milestones={milestones} billingType={project.billingType} />
          </CardContent>
        </Card>
      ),
    },
    {
      value: "files",
      label: "Files",
      icon: "files" as const,
      count: deliverables.length,
      alert: pending.deliverablesAwaitingReview > 0,
      content: <DeliverablesList deliverables={deliverables} />,
    },
    {
      value: "billing",
      label: "Billing & calls",
      icon: "money" as const,
      count: extras.invoices.length,
      alert: pending.unpaidInvoices > 0,
      content: <BillingAndCalls invoices={extras.invoices} meetings={extras.meetings} />,
    },
  ];

  return (
    <div>
      <Link
        href="/portal/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to My Projects
      </Link>

      {/* Project header — where it stands, in one glance. */}
      <section className="surface mb-4 overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">{projectTypeLabels[project.type]}</p>
            <h1 className="title-page mt-1 [overflow-wrap:anywhere]">{project.projectName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ProjectStatusBadge status={project.status} />
            <RequestFormDialog projects={options} defaultProjectId={project.id} />
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {health.done} of {health.total} milestones complete
              </span>
              <span className="num font-semibold">{health.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700"
                style={{ width: `${health.percent}%` }}
              />
            </div>
          </div>
          <div className="flex gap-5 text-sm sm:justify-end">
            <Stat label="Open tasks" value={openTasks} />
            <Stat label="Waiting on you" value={boardWaiting.review + boardWaiting.help} hot />
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
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <BadgeDollarSign className="size-3.5 shrink-0" />
              {usd.format(Number(project.contractPrice))} fixed contract
            </span>
          )}
        </div>

        {hasRichTextContent(project.description) && (
          <details className="group mt-4 border-t pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              Project brief
            </summary>
            <div className="mt-3">
              <RichTextViewer content={project.description} />
            </div>
          </details>
        )}
      </section>

      <ProjectNeedsYou
        pending={pending}
        projectId={project.id}
        board={boardWaiting}
        className="mb-5"
      />

      <ProjectTabs tabs={tabs} defaultTab="board" param="view" />

      <ChatWidget
        projectId={project.id}
        viewerRole="CLIENT"
        initialMessages={messages}
        title="Avix Digital"
        whatsappUrl={whatsappUrl}
      />
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className="text-right">
      <p className={cn("num text-xl font-semibold", hot && value > 0 && "text-primary")}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BillingAndCalls({
  invoices,
  meetings,
}: {
  invoices: Awaited<ReturnType<typeof getMyProjectExtras>>["invoices"];
  meetings: Awaited<ReturnType<typeof getMyProjectExtras>>["meetings"];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="pt-6">
          <h2 className="title-card mb-3 flex items-center gap-2">
            <ReceiptText className="size-4" /> Invoices
          </h2>
          {invoices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No invoices for this project yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((invoice) => (
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
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </span>
                      <InvoiceStatusBadge
                        status={
                          invoice.status as Parameters<typeof InvoiceStatusBadge>[0]["status"]
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

      <Card>
        <CardContent className="pt-6">
          <h2 className="title-card mb-3 flex items-center gap-2">
            <CalendarClock className="size-4" /> Upcoming calls
          </h2>
          {meetings.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No calls booked for this project.</p>
          ) : (
            <ul className="space-y-2">
              {meetings.map((m) => (
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
          )}
          <Link
            href="/portal/book"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Book a call →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
