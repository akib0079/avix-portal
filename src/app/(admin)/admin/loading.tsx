import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-80 rounded-xl" />
    </div>
  );
}
