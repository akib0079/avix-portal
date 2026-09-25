"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Render a long list a page at a time.
 *
 * The admin lists load up to a few hundred rows so search and filters stay
 * instant and client-side — but rendering all of them at once was the
 * expensive part: 300 invoice rows kept a mid-range phone's main thread busy
 * for ~6 seconds. The data is all here; only the DOM is paged.
 *
 * `resetKey` is whatever defines the list (filter + search). When it changes
 * the window snaps back to the first page — a primitive, not the array, so an
 * unmemoised caller can't loop.
 */
export function useProgressive<T>(items: readonly T[], resetKey: string, step = 50) {
  const [state, setState] = useState({ key: resetKey, limit: step });
  let limit = state.limit;
  if (state.key !== resetKey) {
    // Adjusting state while rendering, on a changed input: React's documented
    // alternative to an effect, and it converges in one extra render.
    limit = step;
    setState({ key: resetKey, limit: step });
  }
  return {
    shown: items.slice(0, limit),
    remaining: Math.max(0, items.length - limit),
    showMore: () => setState((s) => ({ ...s, limit: s.limit + step })),
    step,
  };
}

/**
 * The "more" affordance. Loads the next page by itself as it scrolls near the
 * viewport, so a reader just keeps scrolling; the button stays as the visible,
 * keyboard-reachable fallback.
 */
export function ShowMore({
  remaining,
  step,
  onShowMore,
}: {
  remaining: number;
  step: number;
  onShowMore: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef(onShowMore);
  useEffect(() => {
    latest.current = onShowMore;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || remaining <= 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) latest.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [remaining]);

  if (remaining <= 0) return null;
  return (
    <div className="flex justify-center pt-4">
      <button
        ref={ref}
        type="button"
        onClick={onShowMore}
        className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-[var(--hairline)] transition-colors hover:bg-muted hover:text-foreground"
      >
        Show {Math.min(step, remaining)} more
        <span className="text-muted-foreground/60">· {remaining} left</span>
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  );
}
