import Link from "next/link";
import { listTemplates } from "@/lib/dal/marketing";
import { PageHeader } from "@/components/page-header";
import { TemplateManager } from "@/components/marketing/template-manager";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Email Templates" };

export default async function TemplatesPage() {
  await requireAdmin();
  const templates = await listTemplates();

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/admin/marketing" className="hover:text-foreground">
          Marketing
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-foreground/80">Templates</span>
      </nav>
      <PageHeader
        title="Email Templates"
        description="Reusable content for your campaigns."
      />
      <TemplateManager
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          body: t.body,
          updatedAt: t.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
