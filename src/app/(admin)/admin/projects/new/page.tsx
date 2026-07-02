import { listActiveClientOptions } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "New Project" };

export default async function NewProjectPage() {
  const clients = await listActiveClientOptions();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Project"
        description="Set up the engagement — default milestones are added automatically."
      />
      <Card>
        <CardContent className="pt-6">
          <ProjectForm clients={clients} />
        </CardContent>
      </Card>
    </div>
  );
}
