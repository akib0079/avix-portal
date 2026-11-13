"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import type { WorkItemDetail } from "@/lib/board";
import { workItemDetailKey } from "./use-work-item-detail";

type Seed = { itemId: string; promise: Promise<WorkItemDetail | null> };

const SeedContext = createContext<Seed | null>(null);

/**
 * A page opened on one item (?item=) starts that item's drawer detail on the
 * server, after its own reads, and streams it in with the page; the drawer
 * reads it from here instead of fetching it after hydration.
 */
export function DetailSeed({
  itemId,
  promise,
  children,
}: {
  itemId: string | null;
  promise: Promise<WorkItemDetail | null> | null;
  children: ReactNode;
}) {
  const seed = itemId && promise ? { itemId, promise } : null;
  return <SeedContext.Provider value={seed}>{children}</SeedContext.Provider>;
}

// Seeds a drawer has already taken. A seed is read by one drawer only: one
// closed before its seed landed never put it in the cache, and the same
// promise, taken again minutes later, would show the item as it was then.
const takenSeeds = new WeakSet<Promise<WorkItemDetail | null>>();

/** The seed a drawer for itemId should read, or null to fetch as usual. */
export function seedToTake(
  seed: Seed | null,
  itemId: string,
  cached: boolean,
  taken: { has(promise: Promise<WorkItemDetail | null>): boolean },
): Promise<WorkItemDetail | null> | null {
  return seed && seed.itemId === itemId && !cached && !taken.has(seed.promise)
    ? seed.promise
    : null;
}

/**
 * The streamed detail for this item, if the page brought one and nothing has
 * loaded the item since. Taken once, when the drawer opens: a drawer opened
 * again later has the cached copy, or fetches, and revalidates as usual.
 */
export function useDetailSeed(itemId: string): Promise<WorkItemDetail | null> | null {
  const seed = useContext(SeedContext);
  const { cache } = useSWRConfig();
  const [taken] = useState(() =>
    seedToTake(seed, itemId, cache.get(workItemDetailKey(itemId))?.data !== undefined, takenSeeds),
  );
  useEffect(() => {
    if (taken) takenSeeds.add(taken);
  }, [taken]);
  return taken;
}
