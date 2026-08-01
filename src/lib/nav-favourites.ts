"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Pinned sidebar links, per browser.
 *
 * Deliberately localStorage rather than a column on User: pinning has to feel
 * instant and it must not add a query to every layout render. The trade is
 * that favourites are per-device — move to the database if they should follow
 * someone between their laptop and their phone.
 *
 * Read through useSyncExternalStore so there is no effect, no hydration
 * mismatch (the server snapshot is empty) and every mounted sidebar — desktop
 * rail and mobile sheet — stays in step.
 */

const STORAGE_KEY = "avix:nav-favourites";
const EMPTY: string[] = [];

/** Parsed value cached against its raw string: getSnapshot must be stable. */
let cachedRaw: string | null = null;
let cachedValue: string[] = EMPTY;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab pinning something should reorder this one too.
  window.addEventListener("storage", emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", emit);
  };
}

function getSnapshot(): string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    cachedValue = Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : EMPTY;
  } catch {
    // Corrupt value — treat as "nothing pinned" rather than breaking the nav.
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

export function useNavFavourites() {
  const favourites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((href: string) => {
    const current = getSnapshot();
    // Newly pinned items go last, so the order you pin in is the order you get.
    const next = current.includes(href)
      ? current.filter((h) => h !== href)
      : [...current, href];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emit();
  }, []);

  const isFavourite = useCallback(
    (href: string) => favourites.includes(href),
    [favourites],
  );

  return { favourites, toggle, isFavourite };
}
