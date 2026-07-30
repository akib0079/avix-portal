"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
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
 * The project workspace's tab strip. The active tab lives in the URL (?tab=)
 * so a link to "the money tab of this project" is shareable and the back
 * button behaves — panels are server-rendered and passed in as children.
 */
export function ProjectTabs({
  tabs,
  defaultTab,
}: {
  tabs: ProjectTab[];
  defaultTab: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const fromUrl = params.get("tab");
  const active = tabs.some((t) => t.value === fromUrl) ? fromUrl! : defaultTab;

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === defaultTab) next.delete("tab");
    else next.set("tab", value);
    const query = next.toString();
    // scroll:false — switching tabs shouldn't throw you back to the top.
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Tabs value={active} onValueChange={select}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 gap-1.5">
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
        <TabsContent key={tab.value} value={tab.value} className="mt-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
