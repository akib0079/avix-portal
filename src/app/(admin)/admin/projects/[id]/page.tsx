import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/dal/projects";
import { getProjectMessages } from "@/lib/dal/messages";
import { MilestoneBoard } from "@/components/milestones/milestone-board";
import { ChatWidget } from "@/components/messages/chat-widget";
import { toMilestoneView } from "@/components/milestones/milestone-types";
import { ProjectTimeSummary } from "@/components/projects/project-time-summary";
import { ProjectStatusBadge, PriorityBadge, InvoiceStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usd,
  formatDate,
  projectTypeLabels,
  projectSourceLabels,
} from "@/lib/format";
import { ArrowLeft, Pencil, CalendarDays } from "lucide-react";

export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, messages] = await Promise.all([
    getProject(id),
    getProjectMessages(id),
  ]);
  if (!project) notFound();

  const milestones = project.milestones.map(toMilestoneView);
  const showDates = project.startDate || project.dueDate;

  return (
    <div>
      <Link
        href="/admin/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Projects
      </Link>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold">{project.projectName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {project.client ? (
                  <Link
                    href={`/admin/clients/${project.client.id}`}
                    className="hover:text-primary"
                  >
                    {project.client.firstName} {project.client.lastName}
                    {project.client.company ? ` (${project.client.company})` : ""}
                  </Link>
                ) : (
                  "No client"
                )}{" "}
                · {projectTypeLabels[project.type]} ·{" "}
                {projectSourceLabels[project.source]}
              </p>
              {showDates && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {formatDate(project.startDate)} → {formatDate(project.dueDate)}
                </p>
              )}
              {project.billingType === "CONTRACT" && (
                <p className="mt-1 text-sm font-medium text-primary">
                  {project.contractPrice != null
                    ? `${usd.format(Number(project.contractPrice))} fixed contract`
                    : "Fixed contract"}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge priority={project.priority} />
              <ProjectStatusBadge status={project.status} />
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/projects/${project.id}/edit`}>
                  <Pencil /> Edit Project
                </Link>
              </Button>
            </div>
          </div>
          {hasRichTextContent(project.description) && (
            <div className="mt-4 border-t pt-4">
              <RichTextViewer content={project.description} />
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectTimeSummary
        milestones={milestones}
        billingType={project.billingType}
        contractPrice={
          project.contractPrice == null ? null : Number(project.contractPrice)
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <MilestoneBoard
            projectId={project.id}
            milestones={milestones}
            billingType={project.billingType}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Invoices ({project.invoices.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No invoices linked to this project.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="hidden sm:table-cell">Issued</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {usd.format(Number(invoice.amount))}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {project.client && (
        <ChatWidget
          projectId={project.id}
          viewerRole="ADMIN"
          initialMessages={messages}
          title={`Chat with ${project.client.firstName} ${project.client.lastName}`}
        />
      )}
    </div>
  );
}
