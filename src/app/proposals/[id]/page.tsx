import { getPublicProposal } from "@/lib/dal/proposals";
import { verifyProposalToken } from "@/lib/marketing-token";
import { PublicProposalAccept } from "@/components/proposals/public-proposal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your proposal — Avix Digital" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

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

function InvalidLink() {
  return (
    <Shell>
      <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
        <p className="font-heading text-xl font-bold text-foreground">
          This proposal link isn&apos;t valid
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The link may have expired or been copied incompletely. Reply to the email
          we sent and we&apos;ll send you a fresh one.
        </p>
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

export default async function PublicProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  // Gate on the signed, expiring token BEFORE touching proposal data.
  if (!token || !verifyProposalToken(id, token)) return <InvalidLink />;

  const proposal = await getPublicProposal(id);
  if (!proposal) return <InvalidLink />;

  const isOpen = proposal.status === "SENT";
  const isAccepted = proposal.status === "ACCEPTED";

  return (
    <Shell>
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="font-heading text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">
          Avix Digital
        </p>
        <h1 className="mt-3 font-heading text-3xl font-bold text-foreground">
          {proposal.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prepared for {proposal.contactCompany ?? proposal.contactName}
          {proposal.expiresAt && isOpen
            ? ` · valid until ${formatDate(proposal.expiresAt)}`
            : ""}
        </p>
      </div>

      {/* Intro */}
      {proposal.intro && (
        <div className="mb-4 rounded-2xl border bg-card p-6">
          <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
            {proposal.intro}
          </p>
        </div>
      )}

      {/* Scope */}
      <div className="mb-4 rounded-2xl border bg-card p-6">
        <p className="font-heading text-lg font-bold text-foreground">Scope</p>
        <ul className="mt-4 divide-y">
          {proposal.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4 py-3">
              <span className="text-sm text-foreground">{item.description}</span>
              <span className="shrink-0 text-sm font-medium text-foreground">
                {usd.format(item.amount)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="font-heading text-base font-bold text-foreground">Total</span>
          <span className="font-heading text-2xl font-bold text-[#F65D0B]">
            {usd.format(proposal.total)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {proposal.depositPercent}% deposit to start:{" "}
            <strong className="text-foreground">{usd.format(proposal.depositAmount)}</strong>
          </span>
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

      {/* Accept / status */}
      {isOpen && <PublicProposalAccept proposal={proposal} token={token} />}

      {isAccepted && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-6 text-center">
          <p className="font-heading text-lg font-bold text-emerald-900">
            Accepted ✅
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
            {proposal.acceptedName} accepted this proposal
            {proposal.acceptedAt ? ` on ${formatDate(proposal.acceptedAt)}` : ""}. Check
            your email for the link to your client portal.
          </p>
        </div>
      )}

      {!isOpen && !isAccepted && (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This proposal is no longer open. Reply to our email if you&apos;d like us
            to send an updated one.
          </p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Avix Digital · avixdigital.com
      </p>
    </Shell>
  );
}
