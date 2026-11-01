"use client";

import { useEffect, useState } from "react";
import { ViewToggle, VIEW_MODES, type ViewMode } from "@/components/ui/lanes";
import { useLocalChoice } from "@/lib/use-local-pref";
import { WORK_TAB, type WorkView } from "@/lib/board";
import { MilestoneList } from "@/components/milestones/milestone-board";
import { ClientWorkList } from "@/components/projects/client-project-timeline";
import { ProjectBoard } from "./project-board";
import { useWork } from "./work-store";

const VIEW_KEY = "avix.work.view";

/**
 * The Milestones tab: one set of work items, as a List or as a Board. The
 * view comes from the link when it names one (?view=list|board), otherwise
 * from what this viewer last picked, remembered per browser; picking one
 * writes it back to the URL so a shared link opens the same way.
 *
 * Both views read the same store (WorkProvider), so either can mount or
 * unmount freely. One that has been shown stays mounted, hidden, so its
 * filters and folds survive a trip to the other.
 */
export function WorkTab({ initialView }: { initialView: WorkView | null }) {
  const { viewer } = useWork();
  const [remembered, remember] = useLocalChoice<ViewMode>(VIEW_KEY, "board", VIEW_MODES);
  const [picked, setPicked] = useState<ViewMode | null>(initialView);
  // A link elsewhere on the page ("Review 2 items") changes ?view=; follow it.
  // Adjusted during render, not in an effect.
  const [seen, setSeen] = useState(initialView);
  if (initialView !== seen) {
    setSeen(initialView);
    if (initialView) setPicked(initialView);
  }
  const view = picked ?? remembered;

  // An old link (?tab=board&task=…, ?tab=requests, ?view=timeline) has
  // already opened the right place; rewrite the address bar to today's
  // shape, so a copied link is the canonical one. Not a navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    const before = url.search;
    const tab = url.searchParams.get("tab");
    if (tab === "board" || tab === "requests" || tab === "timeline") {
      url.searchParams.set("tab", WORK_TAB);
      // Say which view, or "?tab=milestones" alone would read as the list.
      if (!url.searchParams.get("view")) url.searchParams.set("view", tab === "board" ? "board" : "list");
    }
    if (url.searchParams.get("view") === "timeline") url.searchParams.set("view", "list");
    const task = url.searchParams.get("task");
    if (task) {
      url.searchParams.delete("task");
      if (!url.searchParams.get("item")) url.searchParams.set("item", task);
    }
    if (url.search !== before) window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  // The server renders the linked view, or the board (no stored choice there).
  const [visited, setVisited] = useState<ViewMode[]>(() => [initialView ?? "board"]);
  if (!visited.includes(view)) setVisited([...visited, view]);

  function choose(next: ViewMode) {
    setPicked(next);
    remember(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  const switcher = <ViewToggle value={view} onChange={choose} />;
  return (
    <div>
      {visited.includes("list") && (
        <div className={view === "list" ? undefined : "hidden"}>
          {viewer.side === "CLIENT" ? <ClientWorkList switcher={switcher} /> : <MilestoneList switcher={switcher} />}
        </div>
      )}
      {visited.includes("board") && (
        <div className={view === "board" ? undefined : "hidden"}>
          <ProjectBoard switcher={switcher} />
        </div>
      )}
    </div>
  );
}
