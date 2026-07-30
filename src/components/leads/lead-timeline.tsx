"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLeadEntry, deleteLeadEntry } from "@/lib/actions/leads";
import { leadEntryKindLabels } from "@/lib/validation/lead";
import type { LeadEntryView } from "@/lib/dal/leads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  StickyNote,
  Phone,
  Mail,
  CalendarDays,
  ArrowRightLeft,
  Trash2,
  Loader2,
  Send,
} from "lucide-react";

type Kind = "NOTE" | "CALL" | "EMAIL" | "MEETING";

const KIND_META: Record<
  LeadEntryView["kind"],
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  NOTE: { icon: StickyNote, tone: "text-muted-foreground" },
  CALL: { icon: Phone, tone: "text-sky-600 dark:text-sky-300" },
  EMAIL: { icon: Mail, tone: "text-primary" },
  MEETING: { icon: CalendarDays, tone: "text-emerald-600 dark:text-emerald-300" },
  STAGE: { icon: ArrowRightLeft, tone: "text-amber-600 dark:text-amber-300" },
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The lead's contact log: log a call/email/meeting/note, then read it back. */
export function LeadTimeline({
  leadId,
  entries,
}: {
  leadId: string;
  entries: LeadEntryView[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("NOTE");
  const [body, setBody] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return void toast.error("Write something first.");
    startTransition(async () => {
      const res = await addLeadEntry(leadId, { kind, body });
      if (!res.ok) return void toast.error(res.error);
      setBody("");
      toast.success("Logged.");
      router.refresh();
    });
  }

  function remove(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteLeadEntry(id);
      setDeletingId(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Entry removed.");
      router.refresh();
    });
  }

  return (
    <div>
      {/* Composer */}
      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["NOTE", "CALL", "EMAIL", "MEETING"] as const).map((k) => (
                <SelectItem key={k} value={k}>
                  {leadEntryKindLabels[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            What happened? This stays on the lead.
          </span>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Called — they want a quote by Friday…"
          className="mt-2 text-sm"
        />
        <Button size="sm" className="mt-2" onClick={submit} disabled={pending}>
          {pending && !deletingId ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Log it
        </Button>
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing logged yet — the first call or email you record shows up here.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {entries.map((e, i) => {
            const meta = KIND_META[e.kind];
            const Icon = meta.icon;
            const isLast = i === entries.length - 1;
            return (
              <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                {!isLast && (
                  <span
                    aria-hidden
                    className="absolute top-7 left-[13px] h-[calc(100%-1.5rem)] w-px bg-border"
                  />
                )}
                <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
                  <Icon className={cn("size-3.5", meta.tone)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {leadEntryKindLabels[e.kind]}
                    </span>
                    <span>{when(e.createdAt)}</span>
                    {e.authorName && <span>· {e.authorName}</span>}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{e.body}</p>
                </div>
                {e.kind !== "STAGE" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(e.id)}
                    disabled={pending}
                    aria-label="Delete entry"
                  >
                    {deletingId === e.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
