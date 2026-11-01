import Link from "next/link";
import type { ActivityRow } from "@/lib/dal/activity";
import { formatDistanceToNow } from "date-fns";
import {
  Receipt,
  BadgeCheck,
  FileSignature,
  Flag,
  CalendarDays,
  ThumbsUp,
  Activity as ActivityIcon,
  Target,
  ArrowRightLeft,
  ListPlus,
  Inbox,
  CircleCheck,
  CircleX,
  Archive,
  ArchiveRestore,
  LifeBuoy,
  Trash2,
} from "lucide-react";

/** Icon + colour per activity type; shared with the dashboard timeline. */
export const ACTIVITY_META: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  "invoice.sent": { icon: Receipt, tone: "text-sky-600" },
  "invoice.paid": { icon: BadgeCheck, tone: "text-emerald-600" },
  "invoice.claimed": { icon: Receipt, tone: "text-amber-600" },
  "proposal.accepted": { icon: FileSignature, tone: "text-emerald-600" },
  "milestone.completed": { icon: Flag, tone: "text-primary" },
  "milestone.approved": { icon: ThumbsUp, tone: "text-emerald-600" },
  // Project work (v49: the board and the milestone list are one set of items).
  "work.created": { icon: ListPlus, tone: "text-sky-600" },
  "work.requested": { icon: Inbox, tone: "text-amber-600" },
  "work.accepted": { icon: CircleCheck, tone: "text-emerald-600" },
  "work.declined": { icon: CircleX, tone: "text-muted-foreground" },
  "work.moved": { icon: ArrowRightLeft, tone: "text-primary" },
  "work.archived": { icon: Archive, tone: "text-muted-foreground" },
  "work.restored": { icon: ArchiveRestore, tone: "text-sky-600" },
  "work.deleted": { icon: Trash2, tone: "text-muted-foreground" },
  "work.help": { icon: LifeBuoy, tone: "text-red-600" },
  // The v48 board's events, still in the log.
  "board.created": { icon: ListPlus, tone: "text-sky-600" },
  "board.moved": { icon: ArrowRightLeft, tone: "text-primary" },
  "board.help": { icon: LifeBuoy, tone: "text-red-600" },
  "board.deleted": { icon: Trash2, tone: "text-muted-foreground" },
  "meeting.scheduled": { icon: CalendarDays, tone: "text-sky-600" },
  "lead.created": { icon: Target, tone: "text-sky-600" },
  "lead.stage": { icon: ArrowRightLeft, tone: "text-amber-600" },
  "lead.won": { icon: BadgeCheck, tone: "text-emerald-600" },
  "invoice.drafted": { icon: Receipt, tone: "text-muted-foreground" },
  "deliverable.approved": { icon: BadgeCheck, tone: "text-emerald-600" },
  "deliverable.changes": { icon: Flag, tone: "text-amber-600" },
  "proposal.created": { icon: FileSignature, tone: "text-muted-foreground" },
};

/** Read-only audit timeline. Used on the dashboard and per-client tab. */
export function ActivityFeed({
  items,
  emptyLabel = "No activity yet.",
}: {
  items: ActivityRow[];
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((e) => {
        const meta = ACTIVITY_META[e.type] ?? { icon: ActivityIcon, tone: "text-muted-foreground" };
        const Icon = meta.icon;
        const inner = (
          <>
            <Icon className={`mt-0.5 size-4 shrink-0 ${meta.tone}`} />
            <div className="min-w-0">
              <p className="text-sm leading-snug">{e.summary}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
              </p>
            </div>
          </>
        );
        return (
          <li key={e.id}>
            {e.link ? (
              <Link href={e.link} className="flex gap-2.5 hover:opacity-80">
                {inner}
              </Link>
            ) : (
              <div className="flex gap-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
