import type { Metadata } from "next";
import Link from "next/link";
import { getPublicProposal, type PublicProposalView } from "@/lib/dal/proposals";
import { getSession } from "@/lib/dal/session";
import { readProposalLink } from "@/lib/marketing-token";
import { proposalLinkState } from "@/lib/proposal-token";
import { serverNow } from "@/lib/server-now";
import { ProposalDocument, formatLongDate as formatDate } from "@/components/proposals/proposal-document";
import { ProposalSignPanel } from "@/components/proposals/public-proposal";
import { SignatureCertificate } from "@/components/proposals/signature-certificate";
import { ProposalViewBeacon } from "@/components/proposals/proposal-view-beacon";

export const dynamic = "force-dynamic";

// The link carries a bearer token: keep the page out of search indexes, and
// keep the token out of the Referer header of anything it links to.
export const metadata: Metadata = {
  title: "Your proposal",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </div>
  );
}

/** One centred card for every "this link can't be used" outcome. */
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
        <p className="font-heading text-xl font-bold text-foreground">{title}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{children}</p>
        <a
          href="https://avixdigital.com"
          className="mt-6 inline-block text-sm font-medium text-[#F65D0B] hover:underline"
        >
          avixdigital.com
        </a>
      </div>
    </Shell>
  );
}

function InvalidLink() {
  return (
    <Notice title="This proposal link isn't valid">
      The link may have expired or been copied incompletely. Reply to the email we sent
      and we&apos;ll send you a fresh one.
    </Notice>
  );
}

function AcceptedBanner({ proposal }: { proposal: PublicProposalView }) {
  const method = proposal.signed?.certificate.method;
  const when = proposal.acceptedAt ? ` on ${formatDate(proposal.acceptedAt)}` : "";
  return (
    <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="font-heading text-lg font-bold text-emerald-900 dark:text-emerald-200">
        {method === "DRAWN" || method === "TYPED" ? "Signed ✅" : "Accepted ✅"}
      </p>
      <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
        {method === "DRAWN" || method === "TYPED"
          ? `${proposal.acceptedName} signed this proposal${when}.`
          : `${proposal.acceptedName} accepted this proposal${when}.`}{" "}
        {proposal.portalReady ? (
          <>
            Your project and first invoice are in your{" "}
            <Link href="/login" className="font-medium underline">
              client portal
            </Link>
            .
          </>
        ) : (
          "Check your email for the link to set up your client portal, where your project and first invoice are waiting."
        )}
      </p>
    </div>
  );
}

/**
 * An accepted proposal: the document exactly as signed (from the signature's
 * own snapshot) with its certificate, or, for one accepted before signatures
 * were recorded, the proposal as it stands.
 */
function AcceptedView({ proposal, pdfHref }: { proposal: PublicProposalView; pdfHref: string }) {
  return (
    <>
      <ProposalDocument document={proposal.signed?.document ?? proposal.document} validUntil={null} />
      <AcceptedBanner proposal={proposal} />
      {proposal.signed && <SignatureCertificate certificate={proposal.signed.certificate} pdfHref={pdfHref} />}
    </>
  );
}

function DeclinedPanel({ proposal }: { proposal: PublicProposalView }) {
  return (
    <div className="rounded-2xl border bg-card p-6 text-center">
      <p className="font-heading text-lg font-bold text-foreground">You declined this proposal</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {proposal.declinedAt ? `On ${formatDate(proposal.declinedAt)}. ` : ""}Thanks for
        letting us know. Changed your mind, or want a different scope? Reply to our email.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <p className="mt-8 text-center text-xs text-muted-foreground">Avix Digital · avixdigital.com</p>
  );
}

export default async function PublicProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; preview?: string }>;
}) {
  const [{ id }, { token, preview }] = await Promise.all([params, searchParams]);

  // "Preview as client": the same page for the signed-in team, before or after
  // sending, with every action switched off and nothing recorded.
  if (preview === "1") {
    const session = await getSession();
    if (session?.user.role !== "ADMIN" || session.user.status === "INACTIVE") return <InvalidLink />;
    const proposal = await getPublicProposal(id);
    if (!proposal) return <InvalidLink />;
    return (
      <Shell>
        <div className="mb-6 rounded-xl border border-dashed border-[#F65D0B]/50 bg-card px-4 py-3 text-center text-xs text-muted-foreground">
          <strong className="text-foreground">Preview</strong> — this is what{" "}
          {proposal.contactName} sees{proposal.status === "DRAFT" ? " once it's sent" : ""}. Nothing
          here is recorded or sent.
          {proposal.archived && proposal.status !== "ACCEPTED"
            ? " This proposal is archived: its link shows as withdrawn."
            : ""}
        </div>
        {proposal.status === "ACCEPTED" ? (
          <AcceptedView proposal={proposal} pdfHref={`/api/files/proposal-signed/${proposal.id}`} />
        ) : (
          <>
            <ProposalDocument document={proposal.document} validUntil={proposal.document.expiresAt} />
            {proposal.status === "DECLINED" ? (
              <DeclinedPanel proposal={proposal} />
            ) : proposal.status === "EXPIRED" ? (
              <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                The client sees &ldquo;This proposal has expired&rdquo; instead of this page.
              </div>
            ) : (
              <ProposalSignPanel
                proposalId={proposal.id}
                token=""
                documentHash={proposal.documentHash}
                firstInvoice={proposal.firstInvoice}
                recipient={{ email: proposal.contactEmail, company: proposal.contactCompany }}
                preview
              />
            )}
          </>
        )}
        <Footer />
      </Shell>
    );
  }

  // Gate on the link's signature BEFORE touching proposal data.
  const claims = token ? readProposalLink(id, token) : null;
  if (!token || !claims) return <InvalidLink />;

  const proposal = await getPublicProposal(id);
  if (!proposal || proposal.status === "DRAFT") return <InvalidLink />;

  // Archiving withdraws an offer, but an accepted proposal is the client's
  // agreement: archiving that one only tidies the owner's board.
  if (proposal.archived && proposal.status !== "ACCEPTED") {
    return (
      <Notice title="This proposal was withdrawn">
        We&apos;ve withdrawn this proposal, so it can no longer be accepted. If you were
        expecting it, reply to our email and we&apos;ll sort it out.
      </Notice>
    );
  }

  const state = proposalLinkState(claims, proposal.linkVersion, serverNow());
  if (state === "stale") {
    return (
      <Notice title="This link has been replaced">
        We&apos;ve sent you a newer link to this proposal. Please use the one in our most
        recent email; this one no longer works.
      </Notice>
    );
  }

  // An accepted proposal stays readable after its link's expiry, view-only:
  // it is the client's own agreement. Anything else past expiry is closed.
  if (proposal.status === "ACCEPTED") {
    return (
      <Shell>
        <AcceptedView
          proposal={proposal}
          pdfHref={`/api/files/proposal-signed/${proposal.id}?token=${encodeURIComponent(token)}`}
        />
        <Footer />
      </Shell>
    );
  }

  if (state === "expired" || proposal.status === "EXPIRED") {
    return (
      <Notice title="This proposal has expired">
        {proposal.expiresAt ? `It was open until ${formatDate(proposal.expiresAt)}. ` : ""}
        Reply to our email if you&apos;d still like to go ahead and we&apos;ll send you a
        fresh link.
      </Notice>
    );
  }

  if (proposal.status === "DECLINED") {
    return (
      <Shell>
        <ProposalDocument document={proposal.document} validUntil={null} />
        <DeclinedPanel proposal={proposal} />
        <Footer />
      </Shell>
    );
  }

  return (
    <Shell>
      <ProposalViewBeacon proposalId={proposal.id} token={token} />
      <ProposalDocument document={proposal.document} validUntil={proposal.document.expiresAt} />
      <ProposalSignPanel
        proposalId={proposal.id}
        token={token}
        documentHash={proposal.documentHash}
        firstInvoice={proposal.firstInvoice}
        recipient={{ email: proposal.contactEmail, company: proposal.contactCompany }}
      />
      <Footer />
    </Shell>
  );
}
