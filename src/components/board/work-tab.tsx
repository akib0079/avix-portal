"use client";

import { useState, type ReactNode } from "react";
import { ViewToggle, VIEW_MODES, type ViewMode } from "@/components/ui/lanes";
import { useLocalChoice } from "@/lib/use-local-pref";
import type { WorkView } from "@/lib/board";

const VIEW_KEY = "avix.work.view";

/**
 * The Milestones tab: one set of work items, as a Board or as a List. The
 * view comes from the link when it names one (?view=board|list), otherwise
 * from what this viewer last picked, remembered per browser.
 *
 * Both views stay mounted and the other is hidden, like the project tabs: a
 * card drawer opened from a link lives in the board, and switching costs
 * nothing.
 */
export function WorkTab({
  initialView,
  board,
  list,
}: {
  /** ?view= from the URL, or null when the link didn't say. */
  initialView: WorkView | null;
  board: ReactNode;
  list: ReactNode;
}) {
  const [remembered, remember] = useLocalChoice<ViewMode>(VIEW_KEY, "board", VIEW_MODES);
  const [picked, setPicked] = useState<ViewMode | null>(initialView);
  // A link elsewhere on the page ("Review 2 finished items") changes ?view=;
  // follow it. Adjusted during render, not in an effect.
  const [seen, setSeen] = useState(initialView);
  if (initialView !== seen) {
    setSeen(initialView);
    if (initialView) setPicked(initialView);
  }
  const view = picked ?? remembered;

  function choose(next: ViewMode) {
    setPicked(next);
    remember(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <ViewToggle value={view} onChange={choose} />
      </div>
      <div className={view === "board" ? undefined : "hidden"}>{board}</div>
      <div className={view === "list" ? undefined : "hidden"}>{list}</div>
    </div>
  );
}
