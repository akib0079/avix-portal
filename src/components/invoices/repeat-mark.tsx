import { Repeat } from "lucide-react";
import type { InvoiceListRow } from "./invoice-row";

/** The repeat icon on an invoice that belongs to (or is copied by) a recurring plan. */
export function RepeatMark({ row }: { row: Pick<InvoiceListRow, "planTitle" | "isTemplate"> }) {
  const label = row.planTitle
    ? `Part of the recurring plan “${row.planTitle}”${row.isTemplate ? ", and its template" : ""}`
    : "A recurring plan's template";
  return (
    <span title={label} className="inline-flex shrink-0">
      <Repeat aria-hidden className="size-3 text-primary" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
