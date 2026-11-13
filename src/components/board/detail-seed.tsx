"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
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

/**
 * The streamed detail for this item, if the page brought one and nothing has
 * loaded the item since. Taken once, when the drawer opens: a drawer opened
 * again later has the cached copy and revalidates it as usual.
 */
export function useDetailSeed(itemId: string): Promise<WorkItemDetail | null> | null {
  const seed = useContext(SeedContext);
  const { cache } = useSWRConfig();
  const [taken] = useState(() =>
    seed && seed.itemId === itemId && cache.get(workItemDetailKey(itemId))?.data === undefined
      ? seed.promise
      : null,
  );
  return taken;
}
