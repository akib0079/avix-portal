"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rateMilestone } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function RateMilestone({
  milestoneId,
  rating,
  note,
}: {
  milestoneId: string;
  rating: number | null;
  note: string | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<number | null>(rating);
  const [pendingChoice, setPendingChoice] = useState<1 | -1 | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  // Already rated → compact confirmation (with the note, if any).
  if (current !== null && pendingChoice === null) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {current === 1 ? (
          <ThumbsUp className="size-3.5 text-emerald-600" />
        ) : (
          <ThumbsDown className="size-3.5 text-amber-600" />
        )}
        <span>Thanks for your feedback{note ? ` — “${note}”` : ""}</span>
      </div>
    );
  }

  async function submit(choice: 1 | -1) {
    setBusy(true);
    const res = await rateMilestone(milestoneId, choice, noteText);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setCurrent(choice);
    setPendingChoice(null);
    toast.success("Thanks for your feedback!");
    router.refresh();
  }

  // Picking 👍/👎 opens an optional note, then a confirm.
  if (pendingChoice !== null) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border bg-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          {pendingChoice === 1 ? (
            <ThumbsUp className="size-3.5 text-emerald-600" />
          ) : (
            <ThumbsDown className="size-3.5 text-amber-600" />
          )}
          {pendingChoice === 1 ? "Glad this hit the mark!" : "Sorry this missed."}{" "}
          Anything to add? (optional)
        </p>
        <Textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Your feedback helps us improve…"
          className="text-sm"
        />
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => submit(pendingChoice)}>
            {busy ? <Loader2 className="animate-spin" /> : null} Send feedback
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => setPendingChoice(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Happy with this?</span>
      <Button
        variant="outline"
        size="icon"
        className={cn("size-7")}
        aria-label="Thumbs up"
        onClick={() => setPendingChoice(1)}
      >
        <ThumbsUp className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        aria-label="Thumbs down"
        onClick={() => setPendingChoice(-1)}
      >
        <ThumbsDown className="size-3.5" />
      </Button>
    </div>
  );
}
