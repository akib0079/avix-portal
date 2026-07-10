import { notFound } from "next/navigation";
import { getProject } from "@/lib/dal/projects";
import { listActiveClientOptions } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectInput } from "@/lib/validation/project";

export const metadata = { title: "Edit Project" };

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, clients] = await Promise.all([
    getProject(id),
    listActiveClientOptions(),
  ]);
  if (!project) notFound();

  const initial: ProjectInput & { id: string } = {
    id: project.id,
    projectName: project.projectName,
    clientId: project.clientId ?? "none",
    type: project.type,
    source: project.source,
    priority: project.priority,
    status: project.status,
    billingType: project.billingType,
    contractPrice: project.contractPrice == null ? null : Number(project.contractPrice),
    description: project.description ?? undefined,
    startDate: toDateInput(project.startDate),
    dueDate: toDateInput(project.dueDate),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit Project" description={project.projectName} />
      <Card>
        <CardContent className="pt-6">
          <ProjectForm clients={clients} project={initial} />
        </CardContent>
      </Card>
    </div>
  );
}
