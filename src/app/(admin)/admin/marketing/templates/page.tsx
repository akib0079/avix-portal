import Link from "next/link";
import { listTemplates } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { TemplateManager } from "@/components/marketing/template-manager";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Email Templates" };

export default async function TemplatesPage() {
  await requireAdmin();
  const templates = await listTemplates();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/marketing"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Marketing
      </Link>
      <PageHeader
        title="Email Templates"
        description="Reusable content for your campaigns."
      />
      <Card>
        <CardContent className="pt-6">
          <TemplateManager
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              subject: t.subject,
              body: t.body,
              updatedAt: t.updatedAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
