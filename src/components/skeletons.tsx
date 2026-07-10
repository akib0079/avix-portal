import { Skeleton } from "@/components/ui/skeleton";

/** Wireframes for route loading states (Next.js loading.tsx). */

export function PageHeaderSkeleton() {
  return (
    <div className="mb-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
    </div>
  );
}

/** List page: header + toolbar + table rows. */
export function TablePageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="h-5 w-full max-w-md" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="hidden h-4 w-1/5 sm:block" />
              <Skeleton className="hidden h-4 w-1/6 md:block" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="ml-auto h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Detail page: back link + header card + stacked content cards. */
export function DetailPageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div>
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-8 w-2/3 max-w-sm" />
            <Skeleton className="mt-2 h-4 w-1/2 max-w-xs" />
            <Skeleton className="mt-2 h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="mt-6 rounded-xl border bg-card p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-5 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
