import { Skeleton } from "@/components/ui/skeleton";
import { DeckSkeleton, PanelSkeleton, TilesSkeleton } from "@/components/dashboard/sections";

/** Same frame as the streamed page, so nothing moves when the real one lands. */
export default function AdminLoading() {
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-4 h-10 w-80" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-80 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <DeckSkeleton />
        <PanelSkeleton className="lg:col-span-4" rows={6} />
      </div>
      <TilesSkeleton />
    </div>
  );
}
