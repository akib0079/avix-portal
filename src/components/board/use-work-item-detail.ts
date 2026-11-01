"use client";

import useSWR from "swr";
import type { WorkItemDetail } from "@/lib/board";

const fetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<WorkItemDetail>) : null));

/** The SWR key of one item's drawer payload — shared, so every reader shares the cache. */
export function workItemDetailKey(itemId: string): string {
  return `/api/board-tasks/${itemId}`;
}

/**
 * One item's heavy parts — description, thread, recent hours, the request it
 * came from — loaded on demand. The list and the board carry none of them;
 * whatever opens an item (the drawer, a "Show details" toggle, the time log)
 * asks here, and they all share one cached copy. Pass null to load nothing.
 */
export function useWorkItemDetail(
  itemId: string | null,
  opts: { refreshInterval?: number; revalidateOnFocus?: boolean } = {},
) {
  return useSWR<WorkItemDetail | null>(itemId ? workItemDetailKey(itemId) : null, fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}
