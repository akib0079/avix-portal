import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectWorkspace } from "@/lib/dal/projects";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import { DeliverablesCard } from "@/components/deliverables/deliverables-card";
import { MilestoneBoard } from "@/components/boards-lazy";
import { ChatWidget } from "@/components/messages/chat-widget";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectRail } from "@/components/projects/project-rail";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectAttention } from "@/components/projects/project-attention";
import { ProjectMoney } from "@/components/projects/project-money";
import { ProjectRequests } from "@/components/projects/project-requests";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { Card, CardContent } from "@/components/ui/card";
import { projectHealth, pendingWork } from "@/lib/project-health";
import { ArrowLeft } from "lucide-react";
import { requireTeam } from "@/lib/dal/session";

export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [viewer, project, messages, deliverables, workspace] = await Promise.all([
    requireTeam(),
    getProject(id),
    getProjectMessages(id),
    listByProject(id),
    getProjectWorkspace(id),
  ]);
  if (!project) notFound();
  // Staff are money-blind. getProject already strips prices server-side; this
  // just avoids rendering empty money shells and the billing editor for them.
  const isAdmin = viewer.role === "ADMIN";

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

  const tabs = [
    {
      value: "milestones",
      label: "Milestones",
      count: milestones.length,
      content: (
        <Card>
          <CardContent className="pt-6">
            <MilestoneBoard
              projectId={project.id}
              milestones={milestones}
              billingType={project.billingType}
              canEditPricing={isAdmin}
            />
          </CardContent>
        </Card>
      ),
    },
    {
      value: "deliverables",
      label: "Deliverables",
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
            count: project.invoices.length,
            alert: pending.unpaidInvoices > 0,
            content: (
              <ProjectMoney
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

  return (
    <div>
      <Link
        href="/admin/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Projects
      </Link>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
        {/* Context rail — sticks while you work in the tabs beside it. */}
        <div className="xl:sticky xl:top-16 xl:self-start">
          <ProjectRail
            project={{
              id: project.id,
              projectName: project.projectName,
              status: project.status,
              priority: project.priority,
              type: project.type,
              source: project.source,
              startDate: project.startDate?.toISOString() ?? null,
              dueDate: project.dueDate?.toISOString() ?? null,
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
            canEdit={isAdmin}
          />

          {hasRichTextContent(project.description) && (
            <Card className="mt-4">
              <CardContent className="pt-6">
                <h2 className="font-heading mb-2 text-sm font-semibold">Brief</h2>
                <RichTextViewer content={project.description} />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          <ProjectAttention
            pending={pending}
            projectId={project.id}
            overdue={health.overdue}
            className="mb-4"
          />
          <ProjectTabs tabs={tabs} defaultTab="milestones" />
        </div>
      </div>

      {project.client && (
        <ChatWidget
          projectId={project.id}
          clientId={project.client.id}
          clientTimezone={project.client.timezone}
          viewerRole="ADMIN"
          initialMessages={messages}
          title={`Chat with ${project.client.firstName} ${project.client.lastName}`}
        />
      )}
    </div>
  );
}
