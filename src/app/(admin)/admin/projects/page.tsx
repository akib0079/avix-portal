import Link from "next/link";
import { listProjects } from "@/lib/dal/projects";
import { openClientHelpByProject } from "@/lib/dal/project-board";
import { PageHeader } from "@/components/page-header";
import { ProjectTable } from "@/components/projects/project-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { projectTypeLabels, projectSourceLabels } from "@/lib/format";
import { requireTeam } from "@/lib/dal/session";
import { Plus, FolderKanban } from "lucide-react";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const [viewer, projects, helpByProject] = await Promise.all([
    requireTeam(),
    listProjects(),
    openClientHelpByProject(),
  ]);
  // Creating/deleting projects sets billing, so it stays admin-only — don't
  // offer staff controls that the server would reject anyway.
  const isAdmin = viewer.role === "ADMIN";

  return (
    <div>
      <PageHeader
        title="Projects"
        description={
          isAdmin
            ? "Manage all client projects and milestones."
            : "Client projects and milestones."
        }
        action={
          isAdmin ? (
            <Button asChild>
              <Link href="/admin/projects/new">
                <Plus /> New Project
              </Link>
            </Button>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FolderKanban className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first project to start tracking milestones.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ProjectTable
          canDelete={isAdmin}
          canMove={isAdmin}
          projects={projects.map((project) => ({
            id: project.id,
            projectName: project.projectName,
            sourceLabel: projectSourceLabels[project.source],
            typeLabel: projectTypeLabels[project.type],
            milestoneCount: project._count.milestones,
            milestonesDone: project.milestones.filter((m) => m.status === "COMPLETED").length,
            openTasks: project._count.boardTasks,
            openHelp: helpByProject.get(project.id) ?? 0,
            clientName: project.client
              ? `${project.client.firstName} ${project.client.lastName}`
              : null,
            priority: project.priority,
            status: project.status,
            dueDay: project.dueDate ? project.dueDate.toISOString().slice(0, 10) : null,
            owner: project.owner
              ? {
                  id: project.owner.id,
                  name:
                    `${project.owner.firstName ?? ""} ${project.owner.lastName ?? ""}`.trim() ||
                    "Owner",
                }
              : null,
          }))}
        />
      )}
    </div>
  );
}
