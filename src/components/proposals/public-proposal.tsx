"use client";

import { useState } from "react";
import type { FirstInvoicePromise } from "@/lib/proposal-rules";
import { acceptProposal, declineProposal } from "@/lib/actions/proposals";
import { formatCurrency } from "@/lib/currency";
import { Loader2, CheckCircle2 } from "lucide-react";

/** "your first invoice (£1,500.00)" — the same promise the page makes above. */
function firstInvoiceText(first: FirstInvoicePromise): string | null {
  if (!first) return null;
  if (first.kind === "invoice") {
    return `your first invoice (${formatCurrency(first.amount, first.currency)})`;
  }
  return `the ${first.percent}% deposit invoice (${formatCurrency(first.amount, first.currency)})`;
}

/**
 * The accept / decline step on the public proposal page. The typed name is a
 * lightweight e-signature; the server re-checks the link before doing
 * anything. Once either action succeeds the page re-renders from the server
 * with the new state, so this panel only has to cover the wait.
 *
 * In `preview` the team sees exactly what the client will, with both actions
 * switched off.
 */
export function PublicProposalAccept({
  proposalId,
  token,
  firstInvoice,
  preview = false,
}: {
  proposalId: string;
  token: string;
  firstInvoice: FirstInvoicePromise;
  preview?: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const invoiceText = firstInvoiceText(firstInvoice);

  if (done === "declined") {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center">
        <p className="font-heading text-lg font-bold text-foreground">Thanks for letting us know</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We&apos;ve passed your answer on. If anything changes, just reply to our email.
        </p>
      </div>
    );
  }

  if (done === "accepted") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600 dark:text-emerald-300" />
        <p className="mt-3 font-heading text-lg font-bold text-emerald-900 dark:text-emerald-200">
          You&apos;re all set 🎉
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
          Thanks, {name.trim()}. Your project is set up
          {invoiceText ? ` and ${invoiceText} is on its way` : ""}.
        </p>
      </div>
    );
  }

  async function onAccept() {
    setBusy("accept");
    setError(null);
    const result = await acceptProposal(proposalId, token, name);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDone("accepted");
  }

  async function onDecline() {
    setBusy("decline");
    setError(null);
    const result = await declineProposal(proposalId, token, reason);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDone("declined");
  }

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[#F65D0B] focus:ring-1 focus:ring-[#F65D0B] disabled:cursor-not-allowed disabled:opacity-60";

  if (declining) {
    return (
      <div className="rounded-2xl border bg-card p-6">
        <p className="font-heading text-lg font-bold text-foreground">Decline this proposal?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No hard feelings. If you can, tell us why. It helps us do better next time.
        </p>
        <label
          htmlFor="decline-reason"
          className="mt-5 block text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Reason (optional)
        </label>
        <textarea
          id="decline-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          disabled={preview}
          placeholder="e.g. The budget doesn't work for us right now"
          className={inputClass}
        />

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              setDeclining(false);
              setError(null);
            }}
            disabled={busy !== null}
            className="rounded-lg border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={preview || busy !== null}
            className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "decline" && <Loader2 className="size-4 animate-spin" />}
            Decline proposal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-6">
      <p className="font-heading text-lg font-bold text-foreground">Ready to get started?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Type your full name to accept this proposal. We&apos;ll set up your account
        {invoiceText ? ` and send ${invoiceText}` : ""}.
      </p>

      <label
        htmlFor="signed-name"
        className="mt-5 block text-xs font-semibold tracking-wide text-muted-foreground uppercase"
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
        disabled={preview}
        className={inputClass}
      />

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}

      <button
        type="button"
        onClick={onAccept}
        disabled={preview || busy !== null || name.trim().length < 2}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#F65D0B] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "accept" && <Loader2 className="size-4 animate-spin" />}
        Accept proposal
      </button>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        By accepting you agree to the scope, pricing and terms above.
      </p>
      <p className="mt-4 text-center text-xs">
        <button
          type="button"
          onClick={() => {
            setDeclining(true);
            setError(null);
          }}
          disabled={busy !== null}
          className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Not for you? Decline this proposal
        </button>
      </p>
    </div>
  );
}
