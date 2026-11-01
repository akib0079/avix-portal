"use client";

import { useSyncExternalStore } from "react";
import type { SignatureCertificateView } from "@/lib/dal/proposal-signatures";
import { shortHash } from "@/lib/signature-rules";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/leads/copy-button";
import { signatureFont } from "./signature-font";
import { Download, ShieldAlert, ShieldCheck } from "lucide-react";

const noopSubscribe = () => () => {};

/**
 * The viewer's own zone, read in the browser. The server can't know it, so
 * the server render (and hydration) shows UTC alone and the local time joins
 * it after — no mismatch, no jump of the UTC line.
 */
function useViewerZone(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

function formatIn(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}

function methodLabel(c: SignatureCertificateView): string {
  if (c.method === "DRAWN") return "Drawn on screen";
  if (c.method === "TYPED") return "Typed name, in a signature style";
  return `Recorded by ${c.agencyName}`;
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-sm text-foreground [overflow-wrap:anywhere]", mono && "font-mono text-xs")}>
        {children}
      </dd>
    </div>
  );
}

/**
 * The signature certificate: who signed, how, when and from where, the
 * consent they gave, the fingerprint of exactly what they signed, and how the
 * proposal got to them. Shown on the public page once signed, in the client's
 * portal and in the admin's detail sheet; the signed PDF's last page carries
 * the same facts.
 */
export function SignatureCertificate({
  certificate: c,
  pdfHref,
  className,
}: {
  certificate: SignatureCertificateView;
  /** Where the signed PDF downloads from, for this viewer; null hides the button. */
  pdfHref?: string | null;
  className?: string;
}) {
  const viewerZone = useViewerZone();
  const recorded = c.method === "ADMIN_RECORDED";
  const local = viewerZone && viewerZone !== "UTC" && viewerZone !== "Etc/UTC" ? viewerZone : null;

  return (
    <section
      aria-labelledby={`certificate-${c.id}`}
      className={cn("rounded-2xl border bg-card p-5 sm:p-6", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`certificate-${c.id}`} className="font-heading text-lg font-bold text-foreground">
            Signature certificate
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {recorded
              ? `Recorded by ${c.agencyName} on behalf of ${c.signerName}`
              : `Signed electronically by ${c.signerName}`}
          </p>
        </div>
        {pdfHref && (
          <a
            href={pdfHref}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download className="size-4" /> Signed PDF
          </a>
        )}
      </div>

      {/* Paper in both themes, as on the pad: the ink is dark on transparent. */}
      <div className="mt-4 flex min-h-28 items-center justify-center rounded-xl border bg-white px-4 py-3">
        {c.imageDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URI; nothing to optimise
          <img src={c.imageDataUri} alt={`Signature of ${c.signerName}`} className="max-h-28 w-auto max-w-full" />
        ) : recorded ? (
          <p className="text-center text-sm text-slate-600">
            No signature was drawn: {c.agencyName} recorded this acceptance on {c.signerName}&apos;s
            behalf.
          </p>
        ) : (
          <p
            className={cn(
              signatureFont.className,
              "text-center text-4xl leading-tight text-slate-900 [overflow-wrap:anywhere]",
            )}
          >
            {c.signerName}
          </p>
        )}
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Row label={recorded ? "Agreed by" : "Signed by"}>{c.signerName}</Row>
        <Row label="Email">{c.signerEmail || "—"}</Row>
        {c.signerTitle && <Row label="Job title">{c.signerTitle}</Row>}
        {c.signerCompany && <Row label="Company">{c.signerCompany}</Row>}
        <Row label={recorded ? "Recorded" : "Signed"}>
          {formatIn(c.signedAt, "UTC")}
          {local && (
            <span className="block text-xs text-muted-foreground">
              {formatIn(c.signedAt, local)} your time
            </span>
          )}
        </Row>
        <Row label="Method">{methodLabel(c)}</Row>
        <Row label={recorded ? "Recorded from IP" : "IP address"}>{c.ipAddress ?? "Not available"}</Row>
        <Row label="Browser">{c.browser ?? "Not available"}</Row>
        <Row label="Signature ID" mono>
          {c.id}
        </Row>
        <Row label="Document fingerprint (SHA-256)" mono>
          <span className="inline-flex flex-wrap items-center gap-1">
            <span title={c.documentHash}>{shortHash(c.documentHash)}</span>
            <CopyButton text={c.documentHash} />
          </span>
          <span
            className={cn(
              "mt-1 flex items-center gap-1 font-sans text-xs",
              c.hashVerified ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300",
            )}
          >
            {c.hashVerified ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
            {c.hashVerified
              ? "Matches the document as signed"
              : "Does not match the stored document; contact us"}
          </span>
        </Row>
      </dl>

      <figure className="mt-5 rounded-lg border bg-muted/40 p-3">
        <figcaption className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {recorded ? "Statement" : "Consent given"}
        </figcaption>
        <blockquote className="mt-1 text-sm leading-6 text-foreground">{c.consentText}</blockquote>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{c.consentVersion}</p>
      </figure>

      <div className="mt-5">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Audit trail</h3>
        <ol className="mt-2 space-y-2 border-l pl-4">
          {c.timeline.map((event) => (
            <li key={event.key} className="relative text-sm">
              <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-[#F65D0B]" />
              <span className="font-medium text-foreground">{event.label}</span>
              {event.detail && <span className="text-muted-foreground"> · {event.detail}</span>}
              <span className="block text-xs text-muted-foreground">{formatIn(event.at, "UTC")}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
