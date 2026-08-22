"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-browser view preferences for the tasks page.
 *
 * localStorage rather than a User column for the same reason as
 * [[nav-favourites]]: toggling has to be instant and must not cost a query on
 * every render. Read through useSyncExternalStore so there is no effect and no
 * hydration mismatch — the server snapshot is the default, which is what the
 * HTML is built with.
 *
 * Hiding the auto-created tasks is the one that matters. The duty engine can
 * legitimately produce forty follow-ups in a morning, and a list where your own
 * three notes are buried under them is a list you stop opening.
 */

const STORAGE_KEY = "avix:task-prefs";

export type TaskPrefs = {
  /** Hide origin=SYSTEM tasks. */
  hideAuto: boolean;
  /** Show tasks deferred past their snooze date. */
  showSnoozed: boolean;
};

const DEFAULTS: TaskPrefs = { hideAuto: false, showSnoozed: false };

/** Parsed value cached against its raw string: getSnapshot must be stable. */
let cachedRaw: string | null = null;
let cachedValue: TaskPrefs = DEFAULTS;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", emit);
  };
}

function getSnapshot(): TaskPrefs {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    cachedValue =
      parsed && typeof parsed === "object"
        ? {
            hideAuto: parsed.hideAuto === true,
            showSnoozed: parsed.showSnoozed === true,
          }
        : DEFAULTS;
  } catch {
    // Corrupt value — fall back to defaults rather than breaking the page.
    cachedValue = DEFAULTS;
  }
  return cachedValue;
}

function getServerSnapshot(): TaskPrefs {
  return DEFAULTS;
}

export function useTaskPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((patch: Partial<TaskPrefs>) => {
    const next = { ...getSnapshot(), ...patch };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emit();
  }, []);

  return { prefs, set };
}
