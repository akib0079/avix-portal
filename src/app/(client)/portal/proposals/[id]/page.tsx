import Link from "next/link";
import { notFound } from "next/navigation";
import { getMySignedProposal } from "@/lib/dal/proposals";
import { ProposalDocument, formatLongDate } from "@/components/proposals/proposal-document";
import { SignatureCertificate } from "@/components/proposals/signature-certificate";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Signed proposal" };

/**
 * The client's copy of what they agreed to: the proposal exactly as signed
 * and its signature certificate, with the signed PDF. Reached from the
 * project it started; only the client it was accepted for can open it.
 */
export default async function MySignedProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await getMySignedProposal(id);
  if (!proposal) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={proposal.projectId ? `/portal/projects/${proposal.projectId}` : "/portal/projects"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {proposal.projectId ? "the project" : "My Projects"}
      </Link>

      <ProposalDocument document={proposal.document} validUntil={null} />

      {proposal.certificate ? (
        <SignatureCertificate
          certificate={proposal.certificate}
          pdfHref={`/api/files/proposal-signed/${proposal.id}`}
        />
      ) : (
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          {proposal.acceptedName ?? "You"} accepted this proposal
          {proposal.acceptedAt ? ` on ${formatLongDate(proposal.acceptedAt)}` : ""}, before
          proposals were signed online, so there is no signature certificate for it.
        </div>
      )}
    </div>
  );
}
