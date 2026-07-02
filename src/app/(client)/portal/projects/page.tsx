import Link from "next/link";
import { listMyProjects } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { ProjectStatusBadge } from "@/components/status-badges";
import { ProjectProgress } from "@/components/projects/project-progress";
import { Card, CardContent } from "@/components/ui/card";
import { projectTypeLabels, formatDate } from "@/lib/format";
import { ArrowRight, FolderKanban } from "lucide-react";

export const metadata = { title: "My Projects" };

export default async function MyProjectsPage() {
  const projects = await listMyProjects();

  return (
    <div>
      <PageHeader
        title="My Projects"
        description="Everything Avix Digital is building for you."
      />

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FolderKanban className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your projects appear here once they&apos;re set up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} href={`/portal/projects/${project.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-heading font-semibold">{project.projectName}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {projectTypeLabels[project.type]}
                        {project.dueDate ? ` · due ${formatDate(project.dueDate)}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-3">
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  <ProjectProgress milestones={project.milestones} className="mt-4" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
