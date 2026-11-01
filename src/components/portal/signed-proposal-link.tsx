import Link from "next/link";
import { getMyProjectProposalId } from "@/lib/dal/proposals";
import { FileSignature } from "lucide-react";

/**
 * "Signed proposal" on a client's project, when the project came from one.
 * Its own small read, streamed in behind Suspense, so the project page never
 * waits on it.
 */
export async function SignedProposalLink({ projectId }: { projectId: string }) {
  const id = await getMyProjectProposalId(projectId);
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
