"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { AvixBot } from "@/components/avix-bot";
import { cn } from "@/lib/utils";

type ActivityContextValue = {
  /** Begin an activity; returns a token to pass to stop(). */
  start: (label?: string) => number;
  stop: (token: number) => void;
  /** Wrap a promise so the pill shows for its duration. */
  track: <T>(promise: Promise<T>, label?: string) => Promise<T>;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  // No-op fallback so components work even if the provider isn't mounted
  // (e.g. rendered outside the app shell).
  if (!ctx) {
    return {
      start: () => 0,
      stop: () => {},
      track: (p) => p,
    };
  }
  return ctx;
}

const DEFAULT_LABEL = "Loading…";
const SHOW_DELAY = 150; // don't flash on instant (cached) work
const MIN_VISIBLE = 400; // once shown, keep it up briefly

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  // Map of active token → label. Size > 0 means "something is happening".
  const [active, setActive] = useState<Map<number, string>>(new Map());
  const nextToken = useRef(1);

  const start = useCallback((label = DEFAULT_LABEL) => {
    const token = nextToken.current++;
    setActive((prev) => {
      const next = new Map(prev);
      next.set(token, label);
      return next;
    });
    return token;
  }, []);

  const stop = useCallback((token: number) => {
    setActive((prev) => {
      if (!prev.has(token)) return prev;
      const next = new Map(prev);
      next.delete(token);
      return next;
    });
  }, []);

  const track = useCallback(
    async <T,>(promise: Promise<T>, label?: string): Promise<T> => {
      const token = start(label);
      try {
        return await promise;
      } finally {
        stop(token);
      }
    },
    [start, stop],
  );

  // Newest label wins (the most recent action is the most relevant).
  const labels = [...active.values()];
  const label = labels[labels.length - 1] ?? DEFAULT_LABEL;

  return (
    <ActivityContext.Provider value={{ start, stop, track }}>
      {children}
      <NavigationActivity start={start} stopAll={() => setActive(new Map())} />
      <ActivityPill pending={active.size > 0} label={label} />
    </ActivityContext.Provider>
  );
}

/**
 * Turns internal page navigations into activity: flips on when a real internal
 * link is clicked (or back/forward), off when the pathname settles.
 */
function NavigationActivity({
  start,
  stopAll,
}: {
  start: (label?: string) => number;
  stopAll: () => void;
}) {
  const pathname = usePathname();
  const navToken = useRef<number | null>(null);

  const clearNav = useCallback(() => {
    navToken.current = null;
    stopAll();
  }, [stopAll]);

  // Route settled → clear the navigation activity.
  useEffect(() => {
    clearNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return; // internal only
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      // Same page (in-page anchor) → no navigation.
      if (href === pathname) return;
      if (navToken.current == null) navToken.current = start();
    }
    function onPopState() {
      if (navToken.current == null) navToken.current = start();
    }
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
    };
  }, [pathname, start]);

  return null;
}

/** The visible bottom-center pill, with show-delay + min-visible debouncing. */
function ActivityPill({ pending, label }: { pending: boolean; label: string }) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    if (pending) {
      showTimer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY);
    } else {
      const elapsed = Date.now() - shownAt.current;
      const wait = visible ? Math.max(0, MIN_VISIBLE - elapsed) : 0;
      hideTimer = setTimeout(() => setVisible(false), wait);
    }

    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [pending, visible]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2",
        "flex items-center gap-2.5 rounded-full border border-primary/25 bg-sidebar",
        "py-2 pr-5 pl-3.5 shadow-lg shadow-primary/25",
        "transition-all duration-300",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <AvixBot size={18} />
      <span className="text-sm font-medium text-white">{label}</span>
    </div>
  );
}
