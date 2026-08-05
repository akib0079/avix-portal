"use client";

import { useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type ProjectTab = {
  value: string;
  label: string;
  /** Small count beside the label — omitted when zero. */
  count?: number;
  /** Draws attention: something on this tab is waiting on someone. */
  alert?: boolean;
  content: React.ReactNode;
};

/**
 * The workspace tab strip. Every panel is server-rendered and handed in as a
 * prop, so switching is pure display — no fetching, no suspense.
 *
 * The active tab is LOCAL STATE, seeded from ?tab= on first render. It used to
 * be derived from the URL with router.replace() on click, which meant each
 * click waited on a Next navigation (an RSC round-trip) before the panel
 * changed — content that was already in the browser appeared to load. The URL
 * is still kept in sync for shareable links, but via history.replaceState,
 * which updates the address bar without asking the server for anything.
 */
export function ProjectTabs({
  tabs,
  defaultTab,
}: {
  tabs: ProjectTab[];
  defaultTab: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const fromUrl = params.get("tab");
  const [active, setActive] = useState(() =>
    tabs.some((t) => t.value === fromUrl) ? fromUrl! : defaultTab,
  );

  function select(value: string) {
    // Paint first: this is the only thing the click needs to do.
    setActive(value);

    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    if (value === defaultTab) next.delete("tab");
    else next.set("tab", value);
    const query = next.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Tabs value={active} onValueChange={select}>
      {/* Inline-flex, not full width: stretched triggers read as a nav bar
          rather than tabs, and the active pill got lost against the page. */}
      <TabsList className="inline-flex max-w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="shrink-0 gap-1.5 data-[state=active]:shadow-sm"
          >
            {tab.label}
            {tab.count ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  tab.alert
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        // forceMount keeps every panel in the DOM so switching costs nothing
        // and client state (the board's drag sensors, a half-typed filter)
        // survives leaving and coming back. Radix does NOT hide inactive
        // panels when forceMount is set — without the data-state rule below,
        // all of them render at once.
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="mt-4 data-[state=inactive]:hidden"
          forceMount
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
