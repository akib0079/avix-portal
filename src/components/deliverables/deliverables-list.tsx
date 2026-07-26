import Link from "next/link";
import type { DeliverableRow } from "@/lib/dal/deliverables";
import { Card, CardContent } from "@/components/ui/card";
import { Package, FileText, ExternalLink, Download } from "lucide-react";
import { formatDate } from "@/lib/format";

/** Client-facing downloadable list of a project's deliverables. */
export function DeliverablesList({ deliverables }: { deliverables: DeliverableRow[] }) {
  if (deliverables.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <h2 className="font-heading mb-4 flex items-center gap-2 text-lg font-semibold">
          <Package className="size-5 text-primary" /> Deliverables
        </h2>
        <ul className="divide-y">
          {deliverables.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0">
              {d.externalUrl ? (
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(d.createdAt)}
                </p>
              </div>
              <Link
                href={`/api/files/deliverable/${d.id}`}
                prefetch={false}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              >
                {d.externalUrl ? (
                  <>
                    <ExternalLink className="size-3.5" /> Open
                  </>
                ) : (
                  <>
                    <Download className="size-3.5" /> Download
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
