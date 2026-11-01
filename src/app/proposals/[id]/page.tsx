import type { Metadata } from "next";
import Link from "next/link";
import { getPublicProposal, type PublicProposalView } from "@/lib/dal/proposals";
import { getSession } from "@/lib/dal/session";
import { readProposalLink } from "@/lib/marketing-token";
import { proposalLinkState } from "@/lib/proposal-token";
import { formatCurrency } from "@/lib/currency";
import { serverNow } from "@/lib/server-now";
import { PublicProposalAccept } from "@/components/proposals/public-proposal";
import { ProposalViewBeacon } from "@/components/proposals/proposal-view-beacon";

export const dynamic = "force-dynamic";

// The link carries a bearer token: keep the page out of search indexes, and
// keep the token out of the Referer header of anything it links to.
export const metadata: Metadata = {
  title: "Your proposal",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

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

/** What the client is told they will be invoiced first (see firstInvoicePromise). */
function firstInvoiceLine(proposal: PublicProposalView): React.ReactNode {
  const first = proposal.firstInvoice;
  if (!first) return null;
  if (first.kind === "invoice") {
    return (
      <span>
        First invoice to get started:{" "}
        <strong className="text-foreground">{formatCurrency(first.amount, first.currency)}</strong>
      </span>
    );
  }
  return (
    <span>
      {first.percent}% deposit to start:{" "}
      <strong className="text-foreground">{formatCurrency(first.amount, first.currency)}</strong>
    </span>
  );
}

/** The proposal itself: header, intro, scope and terms. Shared by every state that shows it. */
function ProposalDocument({
  proposal,
  validUntil,
}: {
  proposal: PublicProposalView;
  validUntil: string | null;
}) {
  return (
    <>
      <div className="mb-6 text-center">
        <p className="font-heading text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">
          Avix Digital
        </p>
        <h1 className="mt-3 font-heading text-3xl font-bold [overflow-wrap:anywhere] text-foreground">
          {proposal.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prepared for {proposal.contactCompany ?? proposal.contactName}
          {validUntil ? ` · valid until ${formatDate(validUntil)}` : ""}
        </p>
      </div>

      {proposal.intro && (
        <div className="mb-4 rounded-2xl border bg-card p-6">
          <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
            {proposal.intro}
          </p>
        </div>
      )}

      <div className="mb-4 rounded-2xl border bg-card p-6">
        <p className="font-heading text-lg font-bold text-foreground">Scope</p>
        <ul className="mt-4 divide-y">
          {proposal.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4 py-3">
              <span className="min-w-0 text-sm [overflow-wrap:anywhere] text-foreground">
                {item.description}
              </span>
              <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                {formatCurrency(item.amount, proposal.currency)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
          <span className="font-heading text-base font-bold text-foreground">Total</span>
          <span className="font-heading text-2xl font-bold text-[#F65D0B] tabular-nums">
            {formatCurrency(proposal.total, proposal.currency)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {firstInvoiceLine(proposal)}
          {proposal.timelineWeeks && (
            <span>
              Estimated timeline:{" "}
              <strong className="text-foreground">
                {proposal.timelineWeeks} week{proposal.timelineWeeks === 1 ? "" : "s"}
              </strong>
            </span>
          )}
        </div>
      </div>

      {proposal.terms && (
        <div className="mb-4 rounded-2xl border bg-card p-6">
          <p className="font-heading text-lg font-bold text-foreground">Terms</p>
          <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
            {proposal.terms}
          </p>
        </div>
      )}
    </>
  );
}

function AcceptedBanner({ proposal }: { proposal: PublicProposalView }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="font-heading text-lg font-bold text-emerald-900 dark:text-emerald-200">
        Accepted ✅
      </p>
      <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
        {proposal.acceptedName} accepted this proposal
        {proposal.acceptedAt ? ` on ${formatDate(proposal.acceptedAt)}` : ""}.{" "}
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
    if (session?.user.role !== "ADMIN") return <InvalidLink />;
    const proposal = await getPublicProposal(id);
    if (!proposal) return <InvalidLink />;
    return (
      <Shell>
        <div className="mb-6 rounded-xl border border-dashed border-[#F65D0B]/50 bg-card px-4 py-3 text-center text-xs text-muted-foreground">
          <strong className="text-foreground">Preview</strong> — this is what{" "}
          {proposal.contactName} sees{proposal.status === "DRAFT" ? " once it's sent" : ""}. Nothing
          here is recorded or sent.
          {proposal.archived ? " This proposal is archived: its link shows as withdrawn." : ""}
        </div>
        <ProposalDocument proposal={proposal} validUntil={proposal.expiresAt} />
        {proposal.status === "ACCEPTED" ? (
          <AcceptedBanner proposal={proposal} />
        ) : (
          <PublicProposalAccept
            proposalId={proposal.id}
            token=""
            firstInvoice={proposal.firstInvoice}
            preview
          />
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

  if (proposal.archived) {
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

  // An accepted proposal stays readable after its link's expiry: it is the
  // client's own agreement. Anything else past expiry is closed.
  if (proposal.status === "ACCEPTED") {
    return (
      <Shell>
        <ProposalDocument proposal={proposal} validUntil={null} />
        <AcceptedBanner proposal={proposal} />
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
        <ProposalDocument proposal={proposal} validUntil={null} />
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="font-heading text-lg font-bold text-foreground">You declined this proposal</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {proposal.declinedAt ? `On ${formatDate(proposal.declinedAt)}. ` : ""}Thanks for
            letting us know. Changed your mind, or want a different scope? Reply to our email.
          </p>
        </div>
        <Footer />
      </Shell>
    );
  }

  return (
    <Shell>
      <ProposalViewBeacon proposalId={proposal.id} token={token} />
      <ProposalDocument proposal={proposal} validUntil={proposal.expiresAt} />
      <PublicProposalAccept
        proposalId={proposal.id}
        token={token}
        firstInvoice={proposal.firstInvoice}
      />
      <Footer />
    </Shell>
  );
}
