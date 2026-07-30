import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead, listLeadOwners } from "@/lib/dal/leads";
import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { LeadDetailActions } from "@/components/leads/lead-detail-actions";
import { CopyButton } from "@/components/leads/copy-button";
import { Card, CardContent } from "@/components/ui/card";
import { usd, formatDate } from "@/lib/format";
import { leadSourceLabels, leadStageLabels } from "@/lib/validation/lead";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Tag,
  CalendarClock,
  Target,
  User as UserIcon,
  FileSignature,
} from "lucide-react";

export const metadata = { title: "Lead" };

const stageTone: Record<string, string> = {
  NEW: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  CONTACTED: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PROPOSAL: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  WON: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  LOST: "bg-muted text-muted-foreground",
};

const priorityTone: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  MEDIUM: "bg-muted text-muted-foreground",
  LOW: "bg-muted text-muted-foreground",
};

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [lead, owners] = await Promise.all([getLead(id), listLeadOwners()]);
  if (!lead) notFound();

  const overdue =
    lead.nextFollowUp && new Date(`${lead.nextFollowUp}T23:59:59`) < new Date();

  return (
    <div>
      <Link
        href="/admin/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Leads
      </Link>

      <PageHeader
        title={lead.name}
        description={`${leadSourceLabels[lead.source]} · added ${formatDate(lead.createdAt)}`}
        action={
          <LeadDetailActions
            lead={lead}
            owners={owners}
            proposalCount={lead.proposals.length}
          />
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            stageTone[lead.stage],
          )}
        >
          {leadStageLabels[lead.stage]}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            priorityTone[lead.priority],
          )}
        >
          {lead.priority === "HIGH" ? "High priority" : `${lead.priority.toLowerCase()} priority`}
        </span>
        {lead.convertedClientId && (
          <Link
            href={`/admin/clients/${lead.convertedClientId}`}
            className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:underline dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            Converted → view client
          </Link>
        )}
        {lead.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Facts */}
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-heading mb-1 text-lg font-semibold">Details</h2>
              <div className="divide-y">
                <Row icon={Mail} label="Email">
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="hover:text-primary">
                      {lead.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">
                      None — needed to convert
                    </span>
                  )}
                </Row>
                <Row icon={Phone} label="Phone">
                  {lead.phone ? (
                    <a href={`tel:${lead.phone}`} className="hover:text-primary">
                      {lead.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
                <Row icon={Building2} label="Company">
                  {lead.company ?? <span className="text-muted-foreground">—</span>}
                </Row>
                <Row icon={Target} label="Estimated value">
                  {lead.estimatedValue != null ? (
                    <span className="font-medium text-primary">
                      {usd.format(lead.estimatedValue)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
                <Row icon={UserIcon} label="Owner">
                  {lead.ownerName ?? (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </Row>
                <Row icon={CalendarClock} label="Next follow-up">
                  {lead.nextFollowUp ? (
                    <span className={overdue ? "font-medium text-red-600 dark:text-red-300" : ""}>
                      {formatDate(lead.nextFollowUp)}
                      {overdue ? " · overdue" : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not scheduled</span>
                  )}
                </Row>
                <Row icon={Tag} label="Expected close">
                  {lead.expectedCloseDate ? (
                    formatDate(lead.expectedCloseDate)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
              </div>
              {lead.stage === "LOST" && lead.lostReason && (
                <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Lost because:</span> {lead.lostReason}
                </p>
              )}
            </CardContent>
          </Card>

          {lead.notes && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="font-heading mb-2 text-lg font-semibold">Notes</h2>
                <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Log + pitch + proposals */}
        <div className="space-y-6 xl:col-span-3">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-heading mb-3 text-lg font-semibold">Contact log</h2>
              <LeadTimeline leadId={lead.id} entries={lead.entries} />
            </CardContent>
          </Card>

          {(lead.brandInfo || lead.responseMessage) && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="font-heading mb-3 text-lg font-semibold">Pitch</h2>
                {lead.brandInfo && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Brand info
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{lead.brandInfo}</p>
                  </div>
                )}
                {lead.responseMessage && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Response message
                      </p>
                      <CopyButton text={lead.responseMessage} />
                    </div>
                    <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                      {lead.responseMessage}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <h2 className="font-heading mb-3 flex items-center gap-2 text-lg font-semibold">
                <FileSignature className="size-4 text-primary" /> Proposals (
                {lead.proposals.length})
              </h2>
              {lead.proposals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No proposals for this lead yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {lead.proposals.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2.5">
                      <Link
                        href="/admin/proposals"
                        className="text-sm font-medium hover:text-primary"
                      >
                        {p.title}
                      </Link>
                      <span className="text-sm text-muted-foreground">
                        {usd.format(p.total)} · {p.status.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
