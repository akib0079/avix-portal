import { LeadModal } from "@/components/leads/lead-modal";
import { Skeleton } from "@/components/ui/skeleton";

/** The popup opens at once and fills in when the lead arrives. */
export default function LeadPopupLoading() {
  return (
    <LeadModal title="Loading lead">
      <div className="flex items-center gap-3 border-b px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <Skeleton className="size-11 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 bg-muted/30 p-4 sm:p-6 md:grid-cols-5">
        <Skeleton className="h-80 rounded-2xl md:col-span-2" />
        <Skeleton className="h-80 rounded-2xl md:col-span-3" />
      </div>
    </LeadModal>
  );
}
