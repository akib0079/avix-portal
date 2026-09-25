import { Suspense } from "react";
import { parseRange } from "@/lib/dashboard-ranges";
import { requireAdmin } from "@/lib/dal/session";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { RangeScope, RangeSwitcher } from "@/components/dashboard/range-switcher";
import { Greeting, LiveClock } from "@/components/dashboard/greeting";
import {
  CommandDeck,
  DeckSkeleton,
  DeliveryGrid,
  FlowGrid,
  GridSkeleton,
  MissingUsdNotice,
  MoneyGrid,
  PanelSkeleton,
  PulseRow,
  TilesSkeleton,
  TriagePanel,
} from "@/components/dashboard/sections";

export const metadata = { title: "Dashboard" };

/**
 * The admin dashboard, streamed.
 *
 * It used to await every query (~40 of them, through a five-connection pool)
 * before sending a byte, so the page was as slow as its slowest widget. Now
 * the header paints immediately and each section streams in behind its own
 * Suspense boundary; the shared reads are cache()d in the DAL, so sections
 * that need the same numbers still hit the database once.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireAdmin();
  const range = parseRange((await searchParams).range);

  return (
    <RangeScope>
      <header className="rise mb-8 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <LiveClock />
          <div className="mt-3">
            <Greeting name={user.firstName || user.name} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The pulse of Avix Digital — money, delivery, and what needs you next.
          </p>
        </div>
        <RangeSwitcher active={range} />
      </header>

      <Suspense fallback={null}>
        <MissingUsdNotice range={range} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Suspense fallback={<DeckSkeleton />}>
          <CommandDeck range={range} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="lg:col-span-4" rows={6} />}>
          <TriagePanel />
        </Suspense>
      </div>

      <Suspense fallback={<TilesSkeleton />}>
        <PulseRow range={range} />
      </Suspense>

      <CollapsibleSection id="money" index="02" title="Money">
        <Suspense fallback={<GridSkeleton />}>
          <MoneyGrid range={range} />
        </Suspense>
      </CollapsibleSection>

      <CollapsibleSection id="projects" index="03" title="Delivery">
        <Suspense fallback={<GridSkeleton cols="xl:grid-cols-2" cards={2} />}>
          <DeliveryGrid />
        </Suspense>
      </CollapsibleSection>

      <CollapsibleSection id="activity" index="04" title="Flow">
        <Suspense fallback={<GridSkeleton cols="xl:grid-cols-2" cards={2} />}>
          <FlowGrid />
        </Suspense>
      </CollapsibleSection>
    </RangeScope>
  );
}
