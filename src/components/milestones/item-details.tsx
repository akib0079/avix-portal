"use client";

import { useState } from "react";
import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { useWorkItemDetail } from "@/components/board/use-work-item-detail";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/**
 * A row's details, folded until asked for. The list and the timeline load no
 * descriptions or time notes up front (they come with the item, through
 * useWorkItemDetail), so opening one fetches it — once, then it's cached.
 */
export function ItemDetails({
  itemId,
  hasDescription,
  showNotes = false,
  className,
  bodyClassName,
}: {
  itemId: string;
  hasDescription: boolean;
  /** Also show the latest progress notes from the time log. */
  showNotes?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useWorkItemDetail(open ? itemId : null);
  const notes = showNotes ? (data?.timeEntries ?? []).filter((e) => e.note).slice(0, 3) : [];

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {open ? "Hide details" : "Show details"}
      </button>
      {open && (
        <div className={cn("mt-2 space-y-2", bodyClassName)}>
          {isLoading && !data ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              {hasDescription && hasRichTextContent(data?.description) && (
                <div className="rounded-lg bg-muted/50 px-3.5 py-2.5">
                  <RichTextViewer content={data!.description} />
                </div>
              )}
              {notes.length > 0 && (
                <ul className="space-y-1.5">
                  {notes.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-border bg-card px-3.5 py-2 text-xs"
                    >
                      <span className="font-medium text-foreground">
                        {formatDate(entry.date)} · {fmtHours(entry.hours)}
                      </span>{" "}
                      <span className="whitespace-pre-wrap text-muted-foreground">— {entry.note}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!hasRichTextContent(data?.description) && notes.length === 0 && (
                <p className="text-xs text-muted-foreground">No details yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
