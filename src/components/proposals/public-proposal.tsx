"use client";

import { useState } from "react";
import type { PublicProposalView } from "@/lib/dal/proposals";
import { acceptProposal } from "@/lib/actions/proposals";
import { Loader2, CheckCircle2 } from "lucide-react";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * The accept step on the public proposal page. The typed name is a lightweight
 * e-signature; the server re-verifies the signed token before doing anything.
 */
export function PublicProposalAccept({
  proposal,
  token,
}: {
  proposal: PublicProposalView;
  token: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600" />
        <p className="mt-3 font-heading text-lg font-bold text-emerald-900">
          You&apos;re all set 🎉
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-800">
          Thanks, {name.trim()}. We&apos;ve emailed you a link to set your password
          and open your client portal — your project and first invoice are waiting
          there.
        </p>
      </div>
    );
  }

  async function onAccept() {
    setBusy(true);
    setError(null);
    const result = await acceptProposal(proposal.id, token, name);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setDone(true);
  }

  return (
    <div className="rounded-2xl border bg-white p-6">
      <p className="font-heading text-lg font-bold text-slate-900">
        Ready to get started?
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Type your full name to accept this proposal. We&apos;ll set up your account
        and send the {proposal.depositPercent}% deposit invoice
        ({usd.format(proposal.depositAmount)}).
      </p>

      <label
        htmlFor="signed-name"
        className="mt-5 block text-xs font-semibold tracking-wide text-slate-500 uppercase"
      >
        Your full name
      </label>
      {/*
        autoComplete is deliberately off: a signature must be what this person
        actually typed. With autoComplete="name" the browser silently fills in
        whoever's profile is saved locally, recording the wrong signatory.
      */}
      <input
        id="signed-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Jane Cooper"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#F65D0B] focus:ring-1 focus:ring-[#F65D0B]"
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={onAccept}
        disabled={busy || name.trim().length < 2}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#F65D0B] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Accept proposal
      </button>

      <p className="mt-3 text-center text-xs text-slate-400">
        By accepting you agree to the scope and pricing above.
      </p>
    </div>
  );
}
