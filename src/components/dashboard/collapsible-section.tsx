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
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
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
    <section className="mt-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group mb-3 flex w-full items-center gap-2 text-left"
      >
        <h2 className="font-heading text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="h-px flex-1 bg-border" />
      </button>
      {/* Until the stored value is read, render open to avoid a flash of hidden content. */}
      {(open || !ready) && <div>{children}</div>}
    </section>
  );
}
