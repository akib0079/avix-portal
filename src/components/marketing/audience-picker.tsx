"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AudienceEntry } from "@/lib/dal/marketing";
import type { AudienceFilterInput } from "@/lib/validation/marketing";
import { saveSegment, deleteSegment } from "@/lib/actions/marketing";
import { leadStageLabels, leadSourceLabels } from "@/lib/validation/lead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check, Search, Bookmark, Trash2, Users } from "lucide-react";

export type SegmentOption = { id: string; name: string; filter: AudienceFilterInput };

const AUDIENCES = [
  { value: "both", label: "Everyone" },
  { value: "clients", label: "Clients" },
  { value: "leads", label: "Leads" },
] as const;

const STAGES = ["NEW", "CONTACTED", "PROPOSAL"] as const;
const SOURCES = ["FIVERR", "UPWORK", "REFERRAL", "WEBSITE", "OTHER"] as const;

/**
 * Picks who a campaign goes to across both clients and leads. Filtering runs on
 * the already-loaded mailable list so "select all filtered" always matches what
 * you can see — the server re-resolves the keys on send regardless.
 */
export function AudiencePicker({
  audience,
  segments,
  value,
  onChange,
}: {
  audience: AudienceEntry[];
  segments: SegmentOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<AudienceFilterInput>({ audience: "both" });
  const [savingSegment, setSavingSegment] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const search = filter.search?.trim().toLowerCase();
    return audience.filter((e) => {
      if (filter.audience === "clients" && e.kind !== "client") return false;
      if (filter.audience === "leads" && e.kind !== "lead") return false;
      if (filter.hasActiveProject && e.kind === "client" && !e.hasActiveProject) return false;
      if (filter.stages?.length && e.kind === "lead" && !filter.stages.includes(e.stage!))
        return false;
      if (filter.sources?.length && e.kind === "lead" && !filter.sources.includes(e.source!))
        return false;
      if (search) {
        const hay = `${e.name} ${e.email} ${e.company ?? ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [audience, filter]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((e) => value.includes(e.key));

  function toggle(key: string) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  function toggleInArray<T extends string>(list: T[] | undefined, item: T): T[] | undefined {
    const next = list?.includes(item)
      ? list.filter((v) => v !== item)
      : [...(list ?? []), item];
    return next.length ? next : undefined;
  }

  function applySelectAll() {
    if (allVisibleSelected) {
      const drop = new Set(visible.map((e) => e.key));
      onChange(value.filter((k) => !drop.has(k)));
      return;
    }
    onChange(Array.from(new Set([...value, ...visible.map((e) => e.key)])));
  }

  const leadsShown = filter.audience !== "clients";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-medium">
            Recipients{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({value.length} selected · {visible.length} shown)
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Active clients and leads with an address, minus anyone who unsubscribed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={applySelectAll} disabled={visible.length === 0}>
            {allVisibleSelected ? "Clear shown" : "Select shown"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSavingSegment(true)}
          >
            <Bookmark className="size-3.5" /> Save segment
          </Button>
        </div>
      </div>

      {/* Saved segments */}
      {segments.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Users className="size-3.5 text-muted-foreground" />
          {segments.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
            >
              <button type="button" onClick={() => setFilter(s.filter)} className="hover:underline">
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`Delete ${s.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  const res = await deleteSegment(s.id);
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Segment removed.");
                  router.refresh();
                }}
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 space-y-2 rounded-xl border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-card p-0.5">
            {AUDIENCES.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setFilter((f) => ({ ...f, audience: a.value }))}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  filter.audience === a.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.search ?? ""}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search name, company or email"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {filter.audience !== "leads" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={!!filter.hasActiveProject}
              onChange={(e) =>
                setFilter((f) => ({ ...f, hasActiveProject: e.target.checked || undefined }))
              }
            />
            Clients with an active project only
          </label>
        )}

        {leadsShown && (
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter((f) => ({ ...f, stages: toggleInArray(f.stages, s) }))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  filter.stages?.includes(s)
                    ? "border-primary bg-brand-tint text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {leadStageLabels[s]}
              </button>
            ))}
            <span className="mx-1 w-px bg-border" />
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter((f) => ({ ...f, sources: toggleInArray(f.sources, s) }))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  filter.sources?.includes(s)
                    ? "border-primary bg-brand-tint text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {leadSourceLabels[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nobody matches these filters.
        </div>
      ) : (
        <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {visible.map((e) => {
            const checked = value.includes(e.key);
            return (
              <button
                type="button"
                key={e.key}
                onClick={() => toggle(e.key)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  checked ? "border-primary/40 bg-brand-tint" : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-white" : "border-input bg-card",
                  )}
                >
                  {checked && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.name}
                    {e.company ? ` — ${e.company}` : ""}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{e.email}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {e.meta}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={savingSegment} onOpenChange={setSavingSegment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this audience</DialogTitle>
            <DialogDescription>
              Stores the filters, not the ticked boxes — the list refreshes every
              time you use it.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={segmentName}
            onChange={(e) => setSegmentName(e.target.value)}
            placeholder="e.g. Fiverr leads, not yet pitched"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavingSegment(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !segmentName.trim()}
              onClick={async () => {
                setBusy(true);
                const res = await saveSegment({ name: segmentName, filter });
                setBusy(false);
                if (!res.ok) return void toast.error(res.error);
                setSavingSegment(false);
                setSegmentName("");
                toast.success("Segment saved.");
                router.refresh();
              }}
            >
              <Bookmark /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
