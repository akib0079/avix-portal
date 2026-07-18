import Link from "next/link";
import { listProjects } from "@/lib/dal/projects";
import { PageHeader } from "@/components/page-header";
import { ProjectRowActions } from "@/components/projects/project-row-actions";
import { ProjectStatusBadge, PriorityBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/admin/projects/${project.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {project.projectName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {projectSourceLabels[project.source]} ·{" "}
                        {project._count.milestones} milestones
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {project.client
                        ? `${project.client.firstName} ${project.client.lastName}`
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {projectTypeLabels[project.type]}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <PriorityBadge priority={project.priority} />
                    </TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                    </TableCell>
                    <TableCell>
                      <ProjectRowActions
                        project={{ id: project.id, projectName: project.projectName }}
                        canDelete={isAdmin}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
