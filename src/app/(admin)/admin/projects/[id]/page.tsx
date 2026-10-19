import { notFound } from "next/navigation";
import { getProject, getProjectWorkspace } from "@/lib/dal/projects";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import { DeliverablesCard } from "@/components/deliverables/deliverables-card";
import { MilestoneBoard } from "@/components/boards-lazy";
import { ChatWidget } from "@/components/messages/chat-widget";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectAttention } from "@/components/projects/project-attention";
import { ProjectMoney } from "@/components/projects/project-money";
import { ProjectRequests } from "@/components/projects/project-requests";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { Card, CardContent } from "@/components/ui/card";
import { projectHealth, pendingWork } from "@/lib/project-health";
import { ChevronRight } from "lucide-react";
import { requireTeam } from "@/lib/dal/session";
import { listTeamOptions } from "@/lib/dal/users";
import { getBillableWork } from "@/lib/dal/billable";
import { getBoardCards } from "@/lib/dal/project-board";
import { ProjectBoard } from "@/components/board/project-board";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const [{ id }, { task: taskParam }] = await Promise.all([params, searchParams]);
  // One round trip for everything the page needs — getBillableWork used to run
  // after this block, adding a serial query to every load.
  const [viewer, project, messages, deliverables, workspace, team, billableOrNull, boardCards] =
    await Promise.all([
      requireTeam(),
      getProject(id),
      getProjectMessages(id, { includeInternal: true }),
      listByProject(id),
      getProjectWorkspace(id),
      listTeamOptions(),
      // Money-bearing: getBillableWork requires admin, so staff skip it.
      getBillableWork(id).catch(() => null),
      // No access check inside; requireTeam above is the check, and nothing
      // is rendered unless getProject finds the project.
      getBoardCards(id),
    ]);
  if (!project) notFound();
  // Read once: the board and the header's "due in N days" agree on what now is.
  const renderedAt = serverNow();
  // People and milestones are already loaded for this page; the board reuses
  // them rather than asking the database twice.
  const board = {
    cards: boardCards,
    people: [
      ...team,
      ...(project.client && project.client.status === "ACTIVE"
        ? [
            {
              id: project.client.id,
              name: `${project.client.firstName} ${project.client.lastName}`.trim() || "Client",
              role: "CLIENT" as const,
            },
          ]
        : []),
    ],
    milestones: project.milestones.map((m) => ({ id: m.id, title: m.title })),
  };
  // Staff are money-blind. getProject already strips prices server-side; this
  // just avoids rendering empty money shells and the billing editor for them.
  const isAdmin = viewer.role === "ADMIN";
  const billable = isAdmin ? billableOrNull : null;

  // The milestone include is capped at a recent page of time entries, so the
  // true totals come from the workspace aggregate.
  const milestones = project.milestones.map((m) => {
    const view = toMilestoneView(m);
    return {
      ...view,
      loggedHours: workspace.loggedHoursByMilestone[m.id] ?? view.loggedHours,
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
    requests: workspace.requests,
    invoices: project.invoices,
  });

  const clientHelp = board.cards.filter((c) => c.helpFrom === "CLIENT").length;
  const tabs = [
    {
      value: "board",
      label: "Board",
      icon: "board" as const,
      count: board.cards.filter((c) => c.status !== "DONE").length,
      alert: clientHelp > 0,
      content: (
        <ProjectBoard
          projectId={project.id}
          viewer={{
            id: viewer.id,
            side: "ADMIN",
            name: `${viewer.firstName ?? ""} ${viewer.lastName ?? ""}`.trim() || viewer.name,
          }}
          initial={board}
          renderedAt={renderedAt}
          initialTaskId={taskParam ?? null}
        />
      ),
    },
    {
      value: "milestones",
      label: "Milestones",
      icon: "milestones" as const,
      count: milestones.length,
      content: (
        <Card>
          <CardContent className="pt-6">
            <MilestoneBoard
              projectId={project.id}
              milestones={milestones}
              billingType={project.billingType}
              canEditPricing={isAdmin}
              team={team}
            />
          </CardContent>
        </Card>
      ),
    },
    {
      value: "deliverables",
      label: "Deliverables",
      icon: "files" as const,
      count: deliverables.length,
      alert: pending.deliverablesNeedingChanges > 0,
      content: isAdmin ? (
        <DeliverablesCard projectId={project.id} deliverables={deliverables} />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Deliverables are managed by an admin.
          </CardContent>
        </Card>
      ),
    },
    {
      value: "requests",
      label: "Requests",
      icon: "requests" as const,
      count: workspace.requests.length,
      alert: pending.openRequests > 0,
      content: (
        <ProjectRequests requests={workspace.requests} meetings={workspace.meetings} />
      ),
    },
    ...(isAdmin
      ? [
          {
            value: "money",
            label: "Money",
            icon: "money" as const,
            count: project.invoices.length,
            alert: pending.unpaidInvoices > 0,
            content: (
              <ProjectMoney
                projectId={project.id}
                billable={{
                  lines: billable?.lines ?? [],
                  total: billable?.total ?? 0,
                  unbilled: billable?.unbilled ?? 0,
                }}
                milestones={milestones}
                billingType={project.billingType}
                contractPrice={
                  project.contractPrice == null ? null : Number(project.contractPrice)
                }
                invoices={project.invoices.map((i) => ({
                  id: i.id,
                  invoiceNumber: i.invoiceNumber,
                  issueDate: i.issueDate,
                  amount: Number(i.amount),
                  amountPaid: Number(i.amountPaid),
                  status: i.status,
                }))}
                retainers={workspace.retainers}
              />
            ),
          },
        ]
      : []),
    {
      value: "activity",
      label: "Activity",
      icon: "activity" as const,
      content: (
        <Card>
          <CardContent className="pt-6">
            <ActivityFeed
              items={workspace.activity}
              emptyLabel="Nothing recorded on this project yet."
            />
          </CardContent>
        </Card>
      ),
    },
  ];

  const hoursLogged = Object.values(workspace.loggedHoursByMilestone).reduce(
    (sum, h) => sum + h,
    0,
  );

  return (
    <div className="space-y-5">
      {/* Full width: the header is a band, and the workspace below it gets
          the whole page — the board needs every column visible at once. */}
      <ProjectHeader
        project={{
          id: project.id,
          projectName: project.projectName,
          status: project.status,
          priority: project.priority,
          type: project.type,
          source: project.source,
          startDate: project.startDate?.toISOString() ?? null,
          dueDate: project.dueDate?.toISOString() ?? null,
          ownerId: project.ownerId,
          billingType: project.billingType,
          contractPrice:
            project.contractPrice == null ? null : Number(project.contractPrice),
          client: project.client
            ? {
                id: project.client.id,
                firstName: project.client.firstName,
                lastName: project.client.lastName,
                company: project.client.company,
              }
            : null,
        }}
        milestones={milestones}
        team={team}
        canEdit={isAdmin}
        renderedAt={renderedAt}
        stats={{
          openTasks: board.cards.filter((c) => c.status !== "DONE").length,
          doneTasks: board.cards.filter((c) => c.status === "DONE").length,
          helpRequests: clientHelp,
          hoursLogged,
          unbilled: isAdmin && billable ? billable.unbilled : null,
        }}
        attention={
          <ProjectAttention
            pending={pending}
            projectId={project.id}
            overdue={health.overdue}
            boardHelp={clientHelp}
          />
        }
        brief={
          hasRichTextContent(project.description) ? (
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                Project brief
              </summary>
              <div className="mt-2 rounded-xl border bg-card p-4">
                <RichTextViewer content={project.description} />
              </div>
            </details>
          ) : null
        }
      />

      <ProjectTabs tabs={tabs} defaultTab="board" />

      {project.client && (
        <ChatWidget
          projectId={project.id}
          clientId={project.client.id}
          clientTimezone={project.client.timezone}
          viewerRole="ADMIN"
          initialMessages={messages}
          canWriteInternal
          title={`Chat with ${project.client.firstName} ${project.client.lastName}`}
        />
      )}
    </div>
  );
}
