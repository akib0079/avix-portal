"use client";

import { use, useEffect } from "react";
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
 *
 * `seed` is the detail a deep-linked page streamed in (detail-seed.tsx): it is
 * read with use(), so the caller sits inside a Suspense boundary, and stands
 * in for the first fetch.
 */
export function useWorkItemDetail(
  itemId: string | null,
  {
    seed = null,
    ...opts
  }: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
    seed?: Promise<WorkItemDetail | null> | null;
  } = {},
) {
  const seeded = seed ? use(seed) : undefined;
  const swr = useSWR<WorkItemDetail | null>(itemId ? workItemDetailKey(itemId) : null, fetcher, {
    revalidateOnFocus: false,
    ...opts,
    ...(seed ? { fallbackData: seeded, revalidateOnMount: false } : {}),
  });
  // fallbackData isn't in the cache, and the drawer's own updates
  // (mutate(cur => …)) start from the cache: put the seed there once.
  const { mutate } = swr;
  useEffect(() => {
    if (seed) void mutate((cur) => (cur === undefined ? seeded : cur), { revalidate: false });
  }, [seed, seeded, mutate]);
  return swr;
}
