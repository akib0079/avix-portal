import Link from "next/link";
import { FileSignature } from "lucide-react";

/**
 * "Signed proposal" on a client's project, when the project came from one.
 * The page starts its small read (getMyProjectProposalId) with its own and
 * hands it over; it streams in here behind Suspense, so the page never waits
 * on it.
 */
export async function SignedProposalLink({ proposalId }: { proposalId: Promise<string | null> }) {
  const id = await proposalId;
  if (!id) return null;
  return (
    <Link
      href={`/portal/proposals/${id}`}
      className="flex items-center gap-1.5 font-medium text-primary hover:underline"
    >
      <FileSignature className="size-3.5 shrink-0" /> Signed proposal
    </Link>
  );
}
