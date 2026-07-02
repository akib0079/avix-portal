import { Skeleton } from "@/components/ui/skeleton";

export default function PortalLoading() {
  return (
    <div>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
