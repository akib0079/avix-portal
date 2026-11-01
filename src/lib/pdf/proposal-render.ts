import "server-only";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/dal/settings";
import { deleteUpload, openUpload, saveUpload } from "@/lib/uploads";
import { AUDIT_EVENTS, SIGNATURE_SELECT, toCertificate } from "@/lib/dal/proposal-signatures";
import { documentFromSnapshot, parseSnapshot } from "@/lib/proposal-snapshot";
import { renderProposalPdf } from "@/lib/pdf/proposal-pdf";

/**
 * The signed proposal PDF: rendered from a signature's snapshot, kept in
 * upload storage (kind "contracts") and emailed at signing time. The stored
 * copy is a convenience — the snapshot and its hash in the database are the
 * evidence — so when the file is missing (a host move, a lost disk) the PDF
 * is simply rendered again from the snapshot.
 *
 * UNSCOPED: every caller has authorised already (the sign action, an admin,
 * the client who owns it, or a valid link).
 */

/**
 * The document logo, as the invoice PDF picks it: the dedicated invoice logo
 * (dark, for white paper) when set, else the bundled dark wordmark. The web
 * logo is light-on-dark and would print invisibly.
 */
async function documentLogo(invoiceLogoFile: string | null): Promise<string | null> {
  if (invoiceLogoFile && /\.(png|jpe?g)$/i.test(invoiceLogoFile)) {
    const data = await openUpload("branding", invoiceLogoFile);
    if (data) {
      const mime = /\.png$/i.test(invoiceLogoFile) ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${data.toString("base64")}`;
    }
  }
  try {
    const file = await readFile(path.join(process.cwd(), "public", "avix-logo.png"));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null; // the text wordmark
  }
}

/** "Signed proposal - Shopify store build.pdf", safe for a Content-Disposition header. */
export function signedPdfFileName(title: string): string {
  const safe = title.replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `Signed proposal - ${safe || "Avix Digital"}.pdf`;
}

/** A fresh render for a signature, or null when it (or a readable snapshot) is gone. */
export async function renderSignedProposalPdf(
  signatureId: string,
): Promise<{ pdf: Buffer; title: string } | null> {
  const [row, branding] = await Promise.all([
    prisma.proposalSignature.findUnique({
      where: { id: signatureId },
      select: {
        ...SIGNATURE_SELECT,
        proposal: { select: { firstViewedAt: true, events: AUDIT_EVENTS } },
      },
    }),
    getBranding(),
  ]);
  if (!row) return null;
  const snapshot = parseSnapshot(row.snapshot);
  if (!snapshot) return null;
  const pdf = await renderProposalPdf({
    document: documentFromSnapshot(snapshot),
    certificate: toCertificate(row, row.proposal?.events ?? [], row.proposal?.firstViewedAt ?? null),
    branding: {
      color: branding.color || "#F65D0B",
      logoDataUri: await documentLogo(branding.invoiceLogoFile),
    },
  });
  return { pdf, title: snapshot.title };
}

/**
 * Renders the signed PDF at signing time and keeps it, with its SHA-256, on
 * the signature. Only the first copy is kept: a second run (a retry) leaves
 * the stored one, which is the one that was emailed, alone.
 */
export async function storeSignedProposalPdf(
  signatureId: string,
): Promise<{ pdf: Buffer; title: string } | null> {
  const rendered = await renderSignedProposalPdf(signatureId);
  if (!rendered) return null;
  const saved = await saveUpload(
    "contracts",
    new File([new Uint8Array(rendered.pdf)], "signed-proposal.pdf", { type: "application/pdf" }),
  );
  if (!saved.ok) {
    console.error("[proposals] storing the signed PDF failed:", saved.error);
    return rendered;
  }
  const kept = await prisma.proposalSignature.updateMany({
    where: { id: signatureId, pdfPath: null },
    data: {
      pdfPath: saved.fileName,
      pdfSha256: createHash("sha256").update(rendered.pdf).digest("hex"),
    },
  });
  if (kept.count === 0) await deleteUpload("contracts", saved.fileName);
  return rendered;
}

/** The stored copy when it is there, else a fresh render from the snapshot. */
export async function signedProposalPdf(signature: {
  id: string;
  pdfPath: string | null;
}): Promise<Buffer | null> {
  if (signature.pdfPath) {
    const stored = await openUpload("contracts", signature.pdfPath);
    if (stored) return stored;
  }
  return (await renderSignedProposalPdf(signature.id))?.pdf ?? null;
}
