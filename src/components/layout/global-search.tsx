"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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

const SearchContext = createContext<{ open: () => void } | null>(null);

/** Button that opens the search dialog. Render it anywhere (sidebar, topbar). */
export function SearchTrigger({ tone = "light" }: { tone?: "light" | "dark" }) {
  const ctx = useContext(SearchContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.open}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        tone === "dark"
          ? "border-sidebar-border bg-sidebar-accent/40 text-slate-400 hover:bg-sidebar-accent hover:text-white"
          : "bg-background text-muted-foreground hover:bg-muted/50",
      )}
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">Search…</span>
      <kbd
        className={cn(
          "rounded border px-1.5 text-[10px] font-medium",
          tone === "dark" ? "border-sidebar-border bg-sidebar/60" : "bg-muted",
        )}
      >
        ⌘K
      </kbd>
    </button>
  );
}

/**
 * Owns the ⌘K search dialog once. Any number of <SearchTrigger /> buttons
 * (sidebar desktop + mobile sheet) open the same dialog.
 */
export function GlobalSearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    <SearchContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
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
    </SearchContext.Provider>
  );
}
