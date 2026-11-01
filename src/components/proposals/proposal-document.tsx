import type { ProposalDocumentView } from "@/lib/proposal-snapshot";
import { formatCurrency } from "@/lib/currency";
import { AGENCY_NAME } from "@/lib/signature-rules";

export function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** What the client is told they will be invoiced first (see firstInvoicePromise). */
function firstInvoiceLine(document: ProposalDocumentView) {
  const first = document.firstInvoice;
  if (!first) return null;
  return (
    <span>
      {first.kind === "invoice" ? "First invoice to get started" : `${first.percent}% deposit to start`}:{" "}
      <strong className="text-foreground">{formatCurrency(first.amount, first.currency)}</strong>
    </span>
  );
}

/**
 * The proposal itself: header, intro, scope and terms. Rendered from a
 * snapshot (see documentFromSnapshot), so on the signing page it is exactly
 * what the signature will cover, and on a signed proposal exactly what was
 * signed. Shared by the public page and the client portal.
 */
export function ProposalDocument({
  document,
  validUntil,
}: {
  document: ProposalDocumentView;
  validUntil: string | null;
}) {
  return (
    <>
      <div className="mb-6 text-center">
        <p className="font-heading text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">
          {AGENCY_NAME}
        </p>
        <h1 className="mt-3 font-heading text-3xl font-bold [overflow-wrap:anywhere] text-foreground">
          {document.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prepared for {document.preparedFor}
          {validUntil ? ` · valid until ${formatLongDate(validUntil)}` : ""}
        </p>
      </div>

      {document.intro && (
        <div className="mb-4 rounded-2xl border bg-card p-6">
          <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">{document.intro}</p>
        </div>
      )}

      <div className="mb-4 rounded-2xl border bg-card p-6">
        <p className="font-heading text-lg font-bold text-foreground">Scope</p>
        <ul className="mt-4 divide-y">
          {document.items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-4 py-3">
              <span className="min-w-0 text-sm [overflow-wrap:anywhere] text-foreground">
                {item.description}
              </span>
              <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                {formatCurrency(item.amount, document.currency)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
          <span className="font-heading text-base font-bold text-foreground">Total</span>
          <span className="font-heading text-2xl font-bold text-[#F65D0B] tabular-nums">
            {formatCurrency(document.total, document.currency)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {firstInvoiceLine(document)}
          {document.timelineWeeks && (
            <span>
              Estimated timeline:{" "}
              <strong className="text-foreground">
                {document.timelineWeeks} week{document.timelineWeeks === 1 ? "" : "s"}
              </strong>
            </span>
          )}
        </div>
      </div>

      {document.terms && (
        <div className="mb-4 rounded-2xl border bg-card p-6">
          <p className="font-heading text-lg font-bold text-foreground">Terms</p>
          <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
            {document.terms}
          </p>
        </div>
      )}
    </>
  );
}
