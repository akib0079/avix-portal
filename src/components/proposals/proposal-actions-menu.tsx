"use client";

import Link from "next/link";
import type { ProposalCard } from "@/lib/dal/proposals";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArchiveRestore,
  Bell,
  BellOff,
  CalendarPlus,
  CheckCircle2,
  Copy,
  Eye,
  FolderOpen,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Receipt,
  RefreshCw,
  Send,
  Trash2,
  UserX,
} from "lucide-react";

/** What the menu can ask the board to do; the board owns the dialogs and the busy state. */
export type ProposalMenuHandlers = {
  edit: (p: ProposalCard) => void;
  send: (p: ProposalCard) => void;
  copyLink: (p: ProposalCard) => void;
  duplicate: (p: ProposalCard) => void;
  extend: (p: ProposalCard) => void;
  markAccepted: (p: ProposalCard) => void;
  remove: (p: ProposalCard) => void;
  restore: (p: ProposalCard) => void;
  setReminders: (p: ProposalCard, enabled: boolean) => void;
  markLeadLost: (p: ProposalCard) => void;
};

/**
 * The single "…" menu on a proposal, on the board and in the detail sheet.
 * One menu instead of a row of inline buttons: a narrow lane can't fit five
 * buttons, and the one that mattered most — Delete — used to be the first to
 * wrap out of sight. What's offered follows the proposal's state.
 */
export function ProposalActionsMenu({
  proposal: p,
  handlers,
  busy,
  className,
}: {
  proposal: ProposalCard;
  handlers: ProposalMenuHandlers;
  busy?: boolean;
  className?: string;
}) {
  const archived = p.archivedAt != null;
  const canLoseLead =
    p.status === "DECLINED" && p.leadId != null && p.leadStage !== "LOST" && p.leadStage !== "WON";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          className={cn("size-8 shrink-0 text-muted-foreground hover:text-foreground", className)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          <span className="sr-only">Actions for {p.title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {archived ? (
          <>
            <DropdownMenuItem onClick={() => handlers.restore(p)}>
              <ArchiveRestore /> Restore to the board
            </DropdownMenuItem>
            {p.status === "ACCEPTED" && (
              <DropdownMenuItem onClick={() => handlers.copyLink(p)}>
                <Link2 /> Copy client link
              </DropdownMenuItem>
            )}
          </>
        ) : (
          <>
            {p.status === "DRAFT" && (
              <>
                <DropdownMenuItem onClick={() => handlers.edit(p)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlers.send(p)}>
                  <Send /> Send to {p.contactEmail ?? "recipient"}
                </DropdownMenuItem>
              </>
            )}
            {(p.status === "SENT" || p.status === "ACCEPTED") && (
              <DropdownMenuItem onClick={() => handlers.copyLink(p)}>
                <Link2 /> Copy client link
              </DropdownMenuItem>
            )}
            {(p.status === "SENT" || p.status === "DECLINED") && (
              <DropdownMenuItem onClick={() => handlers.send(p)}>
                <RefreshCw /> Resend with a new link
              </DropdownMenuItem>
            )}
            {(p.status === "SENT" || p.status === "EXPIRED") && (
              <DropdownMenuItem onClick={() => handlers.extend(p)}>
                <CalendarPlus /> {p.status === "EXPIRED" ? "Extend and resend…" : "Extend…"}
              </DropdownMenuItem>
            )}
            {p.status === "ACCEPTED" && p.convertedProjectId && (
              <DropdownMenuItem asChild>
                <Link href={`/admin/projects/${p.convertedProjectId}`}>
                  <FolderOpen /> View project
                </Link>
              </DropdownMenuItem>
            )}
            {p.status === "ACCEPTED" && p.convertedInvoiceId && (
              <DropdownMenuItem asChild>
                <Link href={`/admin/invoices/${p.convertedInvoiceId}`}>
                  <Receipt /> View invoice
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuItem asChild>
          <a href={`/proposals/${p.id}?preview=1`} target="_blank" rel="noopener noreferrer">
            <Eye /> Preview as client
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlers.duplicate(p)}>
          <Copy /> Duplicate…
        </DropdownMenuItem>

        {!archived && (p.status === "DRAFT" || p.status === "SENT" || p.status === "EXPIRED") && (
          <DropdownMenuItem onClick={() => handlers.markAccepted(p)}>
            <CheckCircle2 /> Mark accepted…
          </DropdownMenuItem>
        )}
        {!archived && p.status === "SENT" && (
          <DropdownMenuItem onClick={() => handlers.setReminders(p, !p.remindersEnabled)}>
            {p.remindersEnabled ? <BellOff /> : <Bell />}
            {p.remindersEnabled ? "Pause reminder emails" : "Resume reminder emails"}
          </DropdownMenuItem>
        )}
        {!archived && canLoseLead && (
          <DropdownMenuItem onClick={() => handlers.markLeadLost(p)}>
            <UserX /> Mark the lead as lost…
          </DropdownMenuItem>
        )}

        {!archived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => handlers.remove(p)}>
              <Trash2 /> Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
