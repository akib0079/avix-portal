import Link from "next/link";
import type { ClientSnapshot } from "@/lib/dal/users";
import { LocalTime } from "@/components/local-time";
import { UserStatusBadge, InviteBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { usd, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Mail,
  Phone,
  Building2,
  CalendarClock,
  MessagesSquare,
  FolderPlus,
  ReceiptText,
  ThumbsUp,
  AlertTriangle,
} from "lucide-react";

/** How long without a word before we call the relationship quiet. */
const QUIET_DAYS = 14;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

/**
 * The client's context column: who they are, what they're worth, how the
 * relationship is doing, and the four things you actually do next. Replaces a
 * page that opened with an edit form.
 */
export function ClientRail({
  client,
  snapshot,
}: {
  client: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    company: string | null;
    phone: string | null;
    timezone: string | null;
    status: "ACTIVE" | "INACTIVE";
    emailVerified: boolean;
  };
  snapshot: ClientSnapshot;
}) {
  const quietFor = daysSince(snapshot.lastContactAt);
  const isQuiet = quietFor === null || quietFor >= QUIET_DAYS;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5">
        <h1 className="font-heading text-xl leading-tight font-bold">
          {client.firstName} {client.lastName}
        </h1>
        {client.company && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{client.company}</span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <UserStatusBadge status={client.status} />
          <InviteBadge emailVerified={client.emailVerified} />
        </div>

        <div className="mt-4 space-y-1.5 text-sm">
          <a
            href={`mailto:${client.email}`}
            className="flex items-center gap-2 text-muted-foreground hover:text-primary"
          >
            <Mail className="size-3.5 shrink-0" />
            <span className="truncate">{client.email}</span>
          </a>
          {client.phone && (
            <a
              href={`tel:${client.phone}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-primary"
            >
              <Phone className="size-3.5 shrink-0" />
              {client.phone}
            </a>
          )}
          <LocalTime timezone={client.timezone} />
        </div>

        {/* Relationship temperature — silence is the thing you miss. */}
        <p
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            isQuiet
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
          )}
        >
          {isQuiet && <AlertTriangle className="size-3" />}
          {quietFor === null
            ? "No messages yet"
            : quietFor === 0
              ? "Spoke today"
              : `Last spoke ${quietFor} day${quietFor === 1 ? "" : "s"} ago`}
          {snapshot.lastContactFromClient && quietFor !== null ? " · they replied last" : ""}
        </p>

        {snapshot.nextMeeting && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" />
            Next call {formatDate(snapshot.nextMeeting.startsAt)}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/messages?client=${client.id}`}>
              <MessagesSquare className="size-3.5" /> Message
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/projects/new">
              <FolderPlus className="size-3.5" /> Project
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="col-span-2">
            <Link href="/admin/invoices/new">
              <ReceiptText className="size-3.5" /> New invoice
            </Link>
          </Button>
        </div>
      </div>

      {/* Money + health */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="font-heading mb-3 text-sm font-semibold">Relationship</h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Billed to date</dt>
            <dd className="font-medium">{usd.format(snapshot.billed)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Collected</dt>
            <dd className="font-medium text-emerald-600 dark:text-emerald-400">
              {usd.format(snapshot.collected)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd
              className={cn(
                "font-medium",
                snapshot.outstanding > 0 && "text-amber-600 dark:text-amber-400",
              )}
            >
              {usd.format(snapshot.outstanding)}
            </dd>
          </div>
          {snapshot.overdue > 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Overdue</dt>
              <dd className="font-medium text-red-600 dark:text-red-400">
                {usd.format(snapshot.overdue)}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-2.5">
            <dt className="text-muted-foreground">Projects</dt>
            <dd className="font-medium">
              {snapshot.activeProjects} active / {snapshot.totalProjects}
            </dd>
          </div>
          {snapshot.satisfaction !== null && (
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <ThumbsUp className="size-3.5" /> Satisfaction
              </dt>
              <dd className="font-medium">
                {snapshot.satisfaction}%
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({snapshot.ratedCount} rated)
                </span>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
