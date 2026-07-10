import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyProject, listMyProjectOptions } from "@/lib/dal/portal";
import { getProjectMessages } from "@/lib/dal/messages";
import { ClientProjectTimeline } from "@/components/projects/client-project-timeline";
import { MessageThread } from "@/components/messages/message-thread";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectProgress } from "@/components/projects/project-progress";
import { ProjectStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { projectTypeLabels, formatDate, usd } from "@/lib/format";
import { ArrowLeft, CalendarDays, BadgeDollarSign } from "lucide-react";

export const metadata = { title: "Project" };

export default async function MyProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, options] = await Promise.all([
    getMyProject(id),
    listMyProjectOptions(),
  ]);
  if (!project) notFound();
  // After ownership is confirmed above (getMyProject scopes to the session).
  const messages = await getProjectMessages(project.id);

  const milestones = project.milestones.map(toMilestoneView);

  return (
    <div>
      <Link
        href="/portal/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to My Projects
      </Link>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold">{project.projectName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {projectTypeLabels[project.type]}
              </p>
              {(project.startDate || project.dueDate) && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {formatDate(project.startDate)} → {formatDate(project.dueDate)}
                </p>
              )}
              {project.billingType === "CONTRACT" && project.contractPrice != null && (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-primary">
                  <BadgeDollarSign className="size-3.5" />
                  {usd.format(Number(project.contractPrice))} fixed contract
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <ProjectStatusBadge status={project.status} />
              <RequestFormDialog projects={options} defaultProjectId={project.id} />
            </div>
          </div>
          <ProjectProgress milestones={project.milestones} className="mt-5" />
          {hasRichTextContent(project.description) && (
            <div className="mt-4 border-t pt-4">
              <RichTextViewer content={project.description} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <h2 className="font-heading mb-6 text-lg font-semibold">Project timeline</h2>
          <ClientProjectTimeline
            milestones={milestones}
            billingType={project.billingType}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-heading mb-4 text-lg font-semibold">
            Messages with Avix Digital
          </h2>
          <MessageThread
            projectId={project.id}
            viewerRole="CLIENT"
            initialMessages={messages}
          />
        </CardContent>
      </Card>
    </div>
  );
}
