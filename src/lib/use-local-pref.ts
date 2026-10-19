"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Small per-browser view preferences: which view a list page opens in, which
 * lanes are folded. localStorage for the same reason as the task prefs — a
 * toggle must be instant and must not cost a query — and read through
 * useSyncExternalStore so the server render uses the fallback and hydration
 * never mismatches.
 *
 * Snapshots are the raw stored STRING, which compares by value, so React
 * never sees a "new" snapshot for an unchanged preference. Every access is
 * guarded: storage throws in some private modes and in sandboxed previews,
 * and a preference is never worth breaking the page over.
 */

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", emit);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
  emit();
}

/** One of a fixed set of string values, e.g. "list" | "board". */
export function useLocalChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((next: T) => write(key, next), [key]);
  return [value, set];
}

/**
 * A set of ids, e.g. the lanes someone has folded away. `fallback` applies
 * until the first toggle — after that the stored set is the truth, even empty.
 */
export function useLocalSet(
  key: string,
  fallback: readonly string[] = [],
): [Set<string>, (id: string) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const fallbackKey = fallback.join("\u0000");
  const value = useMemo(() => {
    if (raw === null) return new Set<string>(fallbackKey ? fallbackKey.split("\u0000") : []);
    try {
      const parsed = JSON.parse(raw);
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [raw, fallbackKey]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(key, JSON.stringify([...next]));
    },
    [key, value],
  );
  return [value, toggle];
}
