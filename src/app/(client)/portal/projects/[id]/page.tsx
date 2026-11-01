import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyProject, getMyProjectExtras } from "@/lib/dal/portal";
import { getProjectMessages } from "@/lib/dal/messages";
import { listByProject } from "@/lib/dal/deliverables";
import {
  getBoardPeople,
  getWorkItems,
  getWorkVersion,
  phasesOf,
} from "@/lib/dal/project-board";
import { requireClient } from "@/lib/dal/session";
import { DeliverablesList } from "@/components/deliverables/deliverables-list";
import { getWhatsappSupportUrl } from "@/lib/dal/settings";
import { ProjectNeedsYou } from "@/components/projects/project-needs-you";
import { PortalPulse, PortalUpNext } from "@/components/projects/portal-pulse";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { WorkProvider } from "@/components/board/work-store";
import { WorkTab } from "@/components/board/work-tab";
import { ChatWidget } from "@/components/messages/chat-widget";
import { WORK_TAB, resolveWorkLink } from "@/lib/board";
import { clientWaiting } from "@/lib/work-scope";
import { ProjectStatusBadge, InvoiceStatusBadge } from "@/components/status-badges";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { RequestFormDialog } from "@/components/task-requests/request-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { projectHealth, pendingWork } from "@/lib/project-health";
import { projectTypeLabels, formatDate, usd } from "@/lib/format";
import { formatCurrency } from "@/lib/currency";
import { serverNow } from "@/lib/server-now";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarDays,
  BadgeDollarSign,
  CalendarClock,
  ReceiptText,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { toneChip } from "@/lib/tone";
import { Suspense } from "react";
import { SignedProposalLink } from "@/components/portal/signed-proposal-link";

export const metadata = { title: "Project" };

export default async function MyProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // ?tab=milestones&view=board&item=<id>, and the older shapes that
  // notifications already sent still carry (?view=board&task=<id>, …).
  const link = resolveWorkLink({
    get: (name) => {
      const value = query[name];
      return typeof value === "string" ? value : null;
    },
  });
  // Everything loads in the same wave as the ownership check. The work reads
  // scope themselves to the session; the messages and deliverables don't, so
  // nothing is rendered unless getMyProject — scoped to the session — found
  // the project.
  const [user, project, whatsappUrl, items, version, people, messages, deliverables, extras] =
    await Promise.all([
      requireClient(),
      getMyProject(id),
      getWhatsappSupportUrl(),
      getWorkItems(id),
      getWorkVersion(id),
      getBoardPeople(id),
      getProjectMessages(id),
      listByProject(id),
      getMyProjectExtras(id),
    ]);
  if (!project) notFound();
  // Read once: the header's "due in N days" and the store's freshness check
  // agree on what now is.
  const renderedAt = serverNow();
  const board = { items, people, phases: phasesOf(items), version: version ?? "" };
  // A draft is being prepared and isn't the client's to see yet — kept off
  // this page whatever the read hands back.
  const invoices = extras.invoices.filter((i) => i.status !== "DRAFT");

  const health = projectHealth({
    milestones: items,
    status: project.status,
    dueDate: project.dueDate,
    now: new Date(renderedAt),
  });
  const pending = pendingWork({
    milestones: items,
    deliverables,
    invoices,
  });
  const waiting = clientWaiting(items);
  const openTasks = items.filter((i) => i.stage !== "DONE").length;

  const tabs = [
    {
      value: WORK_TAB,
      label: "Milestones",
      icon: "milestones" as const,
      count: openTasks,
      alert: waiting.review + waiting.questions + waiting.rating > 0,
      content: <WorkTab initialView={link.view} />,
    },
    {
      value: "files",
      label: "Files",
      icon: "files" as const,
      count: deliverables.length,
      alert: pending.deliverablesAwaitingReview > 0,
      content: <DeliverablesList deliverables={deliverables} />,
    },
    {
      value: "billing",
      label: "Billing & calls",
      icon: "money" as const,
      count: invoices.length,
      alert: pending.invoicesToPay > 0,
      content: (
        <BillingAndCalls
          invoices={invoices}
          meetings={extras.meetings}
          timezone={extras.timezone}
        />
      ),
    },
  ];

  return (
    // The work is held once for the whole page — the header's progress, the
    // "needs you" box, the list, the board and the item drawer all read it.
    <WorkProvider
      projectId={project.id}
      viewer={{
        id: user.id,
        side: "CLIENT",
        role: "CLIENT",
        name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.name,
      }}
      billingType={project.billingType}
      initial={board}
      renderedAt={renderedAt}
      initialItemId={link.itemId}
    >
      <div>
        <Link
          href="/portal/projects"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to My Projects
        </Link>

        {/* Project header — where it stands, in one glance. */}
        <section className="surface mb-4 overflow-hidden p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">{projectTypeLabels[project.type]}</p>
              <h1 className="title-page mt-1 [overflow-wrap:anywhere]">{project.projectName}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ProjectStatusBadge status={project.status} />
              {/* The one way to ask for something new: it waits for the team
                  in Requested, on the list and the board. */}
              <RequestFormDialog
                projects={[{ id: project.id, projectName: project.projectName }]}
                defaultProjectId={project.id}
              />
            </div>
          </div>

          <PortalPulse
            status={project.status}
            dueDate={project.dueDate?.toISOString() ?? null}
            renderedAt={renderedAt}
          />

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <PortalUpNext status={project.status} />
            {(project.startDate || project.dueDate) && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                {formatDate(project.startDate)} → {formatDate(project.dueDate)}
              </span>
            )}
            {health.dueLabel && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  health.tone === "bad"
                    ? toneChip.bad
                    : health.tone === "warn"
                      ? toneChip.warn
                      : toneChip.good,
                )}
              >
                {health.overdue && <AlertTriangle className="size-3" />}
                {health.dueLabel}
              </span>
            )}
            {project.billingType === "CONTRACT" && project.contractPrice != null && (
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                <BadgeDollarSign className="size-3.5 shrink-0" />
                {usd.format(Number(project.contractPrice))} fixed contract
              </span>
            )}
            <Suspense fallback={null}>
              <SignedProposalLink projectId={project.id} />
            </Suspense>
          </div>

          {hasRichTextContent(project.description) && (
            <details className="group mt-4 border-t pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                Project brief
              </summary>
              <div className="mt-3">
                <RichTextViewer content={project.description} />
              </div>
            </details>
          )}
        </section>

        <ProjectNeedsYou
          pending={pending}
          projectId={project.id}
          questions={waiting.questions}
          className="mb-5"
        />

        <ProjectTabs tabs={tabs} defaultTab={WORK_TAB} initialTab={link.tab} />

        <ChatWidget
          projectId={project.id}
          viewerRole="CLIENT"
          initialMessages={messages}
          title="Avix Digital"
          whatsappUrl={whatsappUrl}
        />
      </div>
    </WorkProvider>
  );
}

/**
 * A call's start in the client's own zone, with the zone named ("EDT") so the
 * time can't be misread. This renders on the server: without an explicit
 * timeZone, Intl uses the server's (UTC), and a 10:00 call in New York showed
 * as 2:00 PM.
 */
function callTime(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(iso));
  } catch {
    // A malformed stored zone must not take the page down; UTC, labelled.
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}

function BillingAndCalls({
  invoices,
  meetings,
  timezone,
}: {
  invoices: Awaited<ReturnType<typeof getMyProjectExtras>>["invoices"];
  meetings: Awaited<ReturnType<typeof getMyProjectExtras>>["meetings"];
  timezone: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="pt-6">
          <h2 className="title-card mb-3 flex items-center gap-2">
            <ReceiptText className="size-4" /> Invoices
          </h2>
          {invoices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No invoices for this project yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    href={`/portal/invoices/${invoice.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {invoice.invoiceNumber}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(invoice.issueDate)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </span>
                      <InvoiceStatusBadge
                        status={
                          invoice.status as Parameters<typeof InvoiceStatusBadge>[0]["status"]
                        }
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="title-card mb-3 flex items-center gap-2">
            <CalendarClock className="size-4" /> Upcoming calls
          </h2>
          {meetings.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No calls booked for this project.</p>
          ) : (
            <ul className="space-y-2">
              {meetings.map((m) => (
                <li key={m.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {callTime(m.startsAt, timezone)} · {m.durationMins} min
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/portal/book"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Book a call →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
