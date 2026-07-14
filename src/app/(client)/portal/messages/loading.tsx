import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-9 w-44" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
