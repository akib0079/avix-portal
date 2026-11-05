import { notFound } from "next/navigation";
import { getProject, getProjectWorkspace } from "@/lib/dal/projects";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import { DeliverablesCard } from "@/components/deliverables/deliverables-card";
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
import { getWorkItems, getWorkVersion, phasesOf } from "@/lib/dal/project-board";
import { WorkProvider } from "@/components/board/work-store";
import { WorkTab } from "@/components/board/work-tab";
import { WORK_TAB, resolveWorkLink } from "@/lib/board";
import { isPlanItem } from "@/lib/work-scope";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // ?tab=milestones&view=board&item=<id>, and the older shapes that
  // notifications already sent still carry (?tab=board&task=<id>, …).
  const link = resolveWorkLink({
    get: (name) => {
      const value = query[name];
      return typeof value === "string" ? value : null;
    },
  });
  // One round trip for everything the page needs — getBillableWork used to run
  // after this block, adding a serial query to every load.
  const [viewer, project, messages, deliverables, workspace, team, billableOrNull, items, version] =
    await Promise.all([
      requireTeam(),
      getProject(id),
      getProjectMessages(id, { includeInternal: true }),
      listByProject(id),
      getProjectWorkspace(id),
      listTeamOptions(),
      // Money-bearing: getBillableWork requires admin, so staff skip it.
      getBillableWork(id).catch(() => null),
      // The one read of the work: the board, the list, the header and the
      // poll all use these rows. Scoped to the session inside the read.
      getWorkItems(id),
      getWorkVersion(id),
    ]);
  if (!project) notFound();
  // Read once: the board and the header's "due in N days" agree on what now is.
  const renderedAt = serverNow();
  // People are already loaded for this page; the board reuses them rather
  // than asking the database twice.
  const board = {
    items,
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
    phases: phasesOf(items),
    version: version ?? "",
  };
  // Staff are money-blind. getWorkItems and getProject already strip prices
  // server-side; this just avoids rendering empty money shells and the
  // billing editor for them.
  const isAdmin = viewer.role === "ADMIN";
  const billable = isAdmin ? billableOrNull : null;

  const milestones = items.map(toMilestoneView);
  const health = projectHealth({
    milestones: items,
    status: project.status,
    dueDate: project.dueDate,
  });
  const pending = pendingWork({
    milestones: items,
    deliverables,
    invoices: project.invoices.map((i) => ({ status: i.status, creditNoteForId: i.creditNoteForId })),
  });

  const clientHelp = items.filter((i) => i.helpFrom === "CLIENT").length;
  const openItems = items.filter((i) => i.stage !== "DONE").length;
  const tabs = [
    {
      // The board, the plan and the client's requests: one set of items,
      // as a List or a Board (?view=), with requests decided in place.
      value: WORK_TAB,
      label: "Milestones",
      icon: "milestones" as const,
      count: openItems,
      alert: clientHelp > 0 || pending.openRequests > 0,
      content: <WorkTab initialView={link.view} />,
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
                  legacyUsd: billable?.legacyUsd ?? 0,
                  missingUsd: billable?.missingUsd ?? 0,
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
      // What happened and what's coming: calls, the client's past requests
      // (decided ones — open ones wait in the Milestones list), the log.
      value: "activity",
      label: "Activity",
      icon: "activity" as const,
      content: (
        <div className="space-y-6">
          <ProjectRequests
            projectId={project.id}
            requests={workspace.requests}
            meetings={workspace.meetings}
          />
          <Card>
            <CardContent className="pt-6">
              <ActivityFeed
                items={workspace.activity}
                emptyLabel="Nothing recorded on this project yet."
              />
            </CardContent>
          </Card>
        </div>
      ),
    },
  ];

  const hoursLogged = items.reduce((sum, i) => sum + i.loggedHours, 0);

  return (
    // The work is held once for the whole page: the header's ring and
    // counts, the attention strip, the list, the board and the item drawer
    // all read the same live items.
    <WorkProvider
      projectId={project.id}
      viewer={{
        id: viewer.id,
        side: "ADMIN",
        role: isAdmin ? "ADMIN" : "STAFF",
        name: `${viewer.firstName ?? ""} ${viewer.lastName ?? ""}`.trim() || viewer.name,
      }}
      billingType={project.billingType}
      initial={board}
      renderedAt={renderedAt}
      initialItemId={link.itemId}
    >
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
            autoAcceptClientTasks: project.autoAcceptClientTasks,
            client: project.client
              ? {
                  id: project.client.id,
                  firstName: project.client.firstName,
                  lastName: project.client.lastName,
                  company: project.client.company,
                }
              : null,
          }}
          // The plan only, and only what the progress line reads.
          milestones={items
            .filter(isPlanItem)
            .map((i) => ({ id: i.id, title: i.title, status: i.status, position: i.position }))}
          team={team}
          canEdit={isAdmin}
          renderedAt={renderedAt}
          stats={{
            openTasks: openItems,
            doneTasks: items.length - openItems,
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

        <ProjectTabs tabs={tabs} defaultTab={WORK_TAB} initialTab={link.tab} />

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
    </WorkProvider>
  );
}
