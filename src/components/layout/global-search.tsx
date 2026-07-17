"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Search,
  Users,
  FolderKanban,
  FileText,
  Target,
  Loader2,
  CornerDownLeft,
} from "lucide-react";

type Hit = {
  group: "Clients" | "Projects" | "Invoices" | "Leads";
  label: string;
  detail: string;
  href: string;
};

const groupIcon = {
  Clients: Users,
  Projects: FolderKanban,
  Invoices: FileText,
  Leads: Target,
} as const;

/** ⌘K / Ctrl-K global search over clients, projects, invoices, leads. */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ⌘K / Ctrl-K opens; also "/" when not typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = useCallback((q: string) => {
    setQuery(q);
    setActive(0);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = res.ok ? await res.json() : { hits: [] };
        setHits(data.hits ?? []);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery("");
    setHits([]);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 lg:flex"
      >
        <Search className="size-3.5" />
        Search…
        <kbd className="ml-4 rounded border bg-muted px-1.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-4">
            {loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
            <input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search clients, projects, invoices, leads…"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {query.trim().length >= 2 && !loading && hits.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing found for “{query}”.
              </p>
            )}
            {hits.map((hit, i) => {
              const Icon = groupIcon[hit.group];
              const showGroup = i === 0 || hits[i - 1].group !== hit.group;
              return (
                <div key={`${hit.href}-${i}`}>
                  {showGroup && (
                    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {hit.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
                      i === active && "bg-brand-tint",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {hit.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.detail}
                      </span>
                    </span>
                    {i === active && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
