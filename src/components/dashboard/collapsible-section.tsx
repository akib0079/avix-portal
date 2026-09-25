"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A dashboard section the admin can fold away. The state is remembered in
 * localStorage per widget key, so the layout persists across visits.
 */
export function CollapsibleSection({
  id,
  title,
  index,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  /** Section number shown as "02", reading the page like a report. */
  index?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const storageKey = `avix.dash.${id}`;
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);

  // Read the remembered state after mount — localStorage is an external store,
  // so this one-shot sync is the documented escape hatch (server render stays
  // deterministic, which is why it can't be a lazy initializer).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {
      /* private mode — fall back to the default */
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved !== null) setOpen(saved === "1");
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [storageKey]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <section className="mt-10">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group mb-4 flex w-full items-center gap-3 text-left"
      >
        {index && (
          <span className="num text-xs font-semibold text-primary tabular-nums">{index}</span>
        )}
        <h2 className="eyebrow text-foreground">{title}</h2>
        <span className="h-px flex-1 bg-gradient-to-r from-[var(--hairline)] to-transparent" />
        <span className="flex size-6 items-center justify-center rounded-full ring-1 ring-[var(--hairline)] transition-colors group-hover:bg-muted">
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </span>
      </button>
      {/* Until the stored value is read, render open to avoid a flash of hidden content. */}
      {(open || !ready) && <div>{children}</div>}
    </section>
  );
}
