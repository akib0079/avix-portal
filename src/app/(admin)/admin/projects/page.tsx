import Link from "next/link";
import { listProjects } from "@/lib/dal/projects";
import { PageHeader } from "@/components/page-header";
import { ProjectTable } from "@/components/projects/project-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { projectTypeLabels, projectSourceLabels } from "@/lib/format";
import { requireTeam } from "@/lib/dal/session";
import { Plus, FolderKanban } from "lucide-react";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const [viewer, projects] = await Promise.all([requireTeam(), listProjects()]);
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

      <Card>
        <CardContent>
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FolderKanban className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first project to start tracking milestones.
              </p>
            </div>
          ) : (
            <ProjectTable
              canDelete={isAdmin}
              projects={projects.map((project) => ({
                id: project.id,
                projectName: project.projectName,
                sourceLabel: projectSourceLabels[project.source],
                typeLabel: projectTypeLabels[project.type],
                milestoneCount: project._count.milestones,
                clientName: project.client
                  ? `${project.client.firstName} ${project.client.lastName}`
                  : null,
                priority: project.priority,
                status: project.status,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
