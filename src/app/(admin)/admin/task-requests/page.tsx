import Link from "next/link";
import { listTaskRequests } from "@/lib/dal/task-requests";
import { PageHeader } from "@/components/page-header";
import { RequestCard } from "@/components/task-requests/request-card";
import { cn } from "@/lib/utils";
import type { TaskRequestStatus } from "@prisma/client";
import { Inbox } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Task Requests" };

const filters: { label: string; value?: TaskRequestStatus }[] = [
  { label: "All" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
];

export default async function TaskRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const active = filters.find((f) => f.value === status)?.value;
  const requests = await listTaskRequests(active);

  return (
    <div>
      <PageHeader
        title="Task Requests"
        description="Review work requested by clients — approve with pricing or reject with a note."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((filter) => {
          const isActive = filter.value === active;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/task-requests?status=${filter.value}` : "/admin/task-requests"}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-white"
                  : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 font-medium">No requests here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {active
              ? "Nothing with this status right now."
              : "When clients request tasks, they'll show up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}
