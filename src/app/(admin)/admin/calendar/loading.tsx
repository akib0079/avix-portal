import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-9 w-44" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-8 flex items-center justify-between">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <Skeleton className="mt-4 h-[480px] rounded-xl" />
    </div>
  );
}
