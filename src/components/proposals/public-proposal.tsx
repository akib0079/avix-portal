"use client";

import { useRef, useState } from "react";
import type { FirstInvoicePromise } from "@/lib/proposal-rules";
import { declineProposal, signProposal } from "@/lib/actions/proposals";
import { formatCurrency } from "@/lib/currency";
import { SIGNATURE_CONSENT_VERSION, signatureConsentText } from "@/lib/signature-rules";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { signatureFont } from "./signature-font";
import { CheckCircle2, Keyboard, Loader2, PenLine, RotateCw } from "lucide-react";

/** "your first invoice (£1,500.00)" — the same promise the page makes above. */
function firstInvoiceText(first: FirstInvoicePromise): string | null {
  if (!first) return null;
  if (first.kind === "invoice") {
    return `your first invoice (${formatCurrency(first.amount, first.currency)})`;
  }
  return `the ${first.percent}% deposit invoice (${formatCurrency(first.amount, first.currency)})`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Long names step down a size so they stay on the line on a phone. */
function typedSize(name: string): string {
  if (name.length <= 16) return "text-4xl sm:text-5xl";
  if (name.length <= 28) return "text-3xl sm:text-4xl";
  return "text-2xl sm:text-3xl";
}

type Method = "DRAWN" | "TYPED";
type Field = "name" | "email" | "signature" | "consent";

/**
 * Signing on the public proposal page: who is signing, their signature
 * (drawn, or typed and rendered in a script face), and an explicit consent to
 * sign electronically. The server re-checks everything: the link, the
 * signature image, the consent wording's version, and that the proposal is
 * still the one this page rendered (documentHash). Once signing or declining
 * succeeds the page re-renders from the server with the new state, so this
 * panel only has to cover the wait.
 *
 * Typing is the keyboard-only path: every control here, the Draw / Type tabs
 * included, works without a pointer.
 *
 * In `preview` the team sees exactly what the client will, with both actions
 * switched off.
 */
export function ProposalSignPanel({
  proposalId,
  token,
  documentHash,
  firstInvoice,
  recipient,
  preview = false,
}: {
  proposalId: string;
  token: string;
  documentHash: string;
  firstInvoice: FirstInvoicePromise;
  recipient: { email: string | null; company: string | null };
  preview?: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(recipient.email ?? "");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState(recipient.company ?? "");
  const [method, setMethod] = useState<Method>("DRAWN");
  const [hasInk, setHasInk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<{ message: string; field?: Field; reload?: boolean } | null>(null);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const pad = useRef<SignaturePadHandle>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const invoiceText = firstInvoiceText(firstInvoice);
  const typedName = name.trim();

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

  if (done === "signed") {
    return (
      <div
        role="status"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40"
      >
        <CheckCircle2 className="mx-auto size-8 text-emerald-600 dark:text-emerald-300" />
        <p className="mt-3 font-heading text-lg font-bold text-emerald-900 dark:text-emerald-200">
          Signed. You&apos;re all set 🎉
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-300">
          Thanks, {typedName}. Your project is set up
          {invoiceText ? ` and ${invoiceText} is on its way` : ""}. A signed copy is on its way
          to {email.trim()}.
        </p>
      </div>
    );
  }

  /** Points at the first thing missing, in the order the form asks for it. */
  function invalid(): { message: string; field: Field } | null {
    if (typedName.length < 2) return { message: "Type your full name.", field: "name" };
    if (!EMAIL.test(email.trim())) return { message: "Enter a valid email for your signed copy.", field: "email" };
    if (method === "DRAWN" && !hasInk) {
      return { message: "Draw your signature in the box, or choose Type.", field: "signature" };
    }
    if (!consent) return { message: "Tick the box to agree to sign electronically.", field: "consent" };
    return null;
  }

  async function onSign() {
    const problem = invalid();
    if (problem) {
      setError(problem);
      if (problem.field === "name") nameRef.current?.focus();
      if (problem.field === "email") emailRef.current?.focus();
      if (problem.field === "consent") consentRef.current?.focus();
      return;
    }
    const imagePng = method === "DRAWN" ? pad.current?.toPng() : undefined;
    if (method === "DRAWN" && !imagePng) {
      setError({ message: "Draw your signature in the box, or choose Type.", field: "signature" });
      return;
    }
    setBusy("sign");
    setError(null);
    try {
      const result = await signProposal(proposalId, token, {
        signerName: typedName,
        signerEmail: email.trim(),
        signerTitle: jobTitle.trim(),
        signerCompany: company.trim(),
        method,
        imagePng: imagePng ?? undefined,
        consent: true,
        consentVersion: SIGNATURE_CONSENT_VERSION,
        documentHash,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      });
      if (!result.ok) {
        setError({ message: result.error, reload: "reload" in result && result.reload });
        return;
      }
      setDone("signed");
    } catch {
      setError({ message: "Something went wrong while signing. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function onDecline() {
    setBusy("decline");
    setError(null);
    const result = await declineProposal(proposalId, token, reason);
    setBusy(null);
    if (!result.ok) return setError({ message: result.error });
    setDone("declined");
  }

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[#F65D0B] focus:ring-1 focus:ring-[#F65D0B] disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-500";
  const labelClass = "block text-xs font-semibold tracking-wide text-muted-foreground uppercase";

  const errorLine = error && (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-red-600 dark:text-red-300">
      <span>{error.message}</span>
      {error.reload && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          <RotateCw className="size-3.5" /> Reload the proposal
        </button>
      )}
    </div>
  );

  if (declining) {
    return (
      <div className="rounded-2xl border bg-card p-6">
        <p className="font-heading text-lg font-bold text-foreground">Decline this proposal?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No hard feelings. If you can, tell us why. It helps us do better next time.
        </p>
        <label htmlFor="decline-reason" className={cn(labelClass, "mt-5")}>
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

        {errorLine}

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
        Sign below to accept this proposal. We&apos;ll set up your account
        {invoiceText ? ` and send ${invoiceText}` : ""}.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="signer-name" className={labelClass}>
            Your full name
          </label>
          {/*
            autoComplete is deliberately off: a signature must be what this
            person actually typed. With autoComplete="name" the browser
            silently fills in whoever's profile is saved locally, recording
            the wrong signatory.
          */}
          <input
            id="signer-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jane Cooper"
            maxLength={120}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            required
            aria-invalid={error?.field === "name" || undefined}
            disabled={preview}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="signer-email" className={labelClass}>
            Email
          </label>
          <input
            id="signer-email"
            ref={emailRef}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={255}
            autoComplete="email"
            required
            aria-invalid={error?.field === "email" || undefined}
            aria-describedby="signer-email-hint"
            disabled={preview}
            className={inputClass}
          />
          <p id="signer-email-hint" className="mt-1 text-xs text-muted-foreground">
            Your signed copy goes here.
          </p>
        </div>
        <div>
          <label htmlFor="signer-title" className={labelClass}>
            Job title <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="signer-title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Founder"
            maxLength={120}
            autoComplete="organization-title"
            disabled={preview}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="signer-company" className={labelClass}>
            Company <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="signer-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={160}
            autoComplete="organization"
            disabled={preview}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-6">
        <p id="signature-label" className={labelClass}>
          Your signature
        </p>
        <Tabs
          value={method}
          onValueChange={(value) => {
            setMethod(value as Method);
            if (error?.field === "signature") setError(null);
          }}
          className="mt-2"
        >
          <TabsList aria-labelledby="signature-label" className="w-full sm:w-fit">
            <TabsTrigger value="DRAWN" disabled={preview} className="px-3">
              <PenLine /> Draw
            </TabsTrigger>
            <TabsTrigger value="TYPED" disabled={preview} className="px-3">
              <Keyboard /> Type
            </TabsTrigger>
          </TabsList>
          {/* Kept mounted while Type is showing, so switching back finds the drawing intact. */}
          <TabsContent value="DRAWN" forceMount className="data-[state=inactive]:hidden">
            <SignaturePad
              ref={pad}
              disabled={preview || busy !== null}
              onInkChange={(ink) => {
                setHasInk(ink);
                if (ink && error?.field === "signature") setError(null);
              }}
            />
          </TabsContent>
          <TabsContent value="TYPED">
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white px-4 sm:h-44">
              <p
                aria-live="polite"
                className={cn(
                  signatureFont.className,
                  typedSize(typedName),
                  "text-center leading-tight [overflow-wrap:anywhere]",
                  typedName ? "text-slate-900" : "text-slate-300",
                )}
              >
                {typedName || "Your name"}
              </p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Your full name from above, set in a signature style.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:disabled]:cursor-not-allowed">
        <input
          ref={consentRef}
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (e.target.checked && error?.field === "consent") setError(null);
          }}
          aria-invalid={error?.field === "consent" || undefined}
          disabled={preview}
          className="mt-1 size-4 shrink-0 accent-[#F65D0B]"
        />
        <span className="leading-6 text-foreground">{signatureConsentText(company)}</span>
      </label>

      {errorLine}

      <button
        type="button"
        onClick={onSign}
        disabled={preview || busy !== null}
        aria-busy={busy === "sign"}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#F65D0B] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "sign" && <Loader2 className="size-4 animate-spin" />}
        {busy === "sign" ? "Signing…" : "Sign and accept"}
      </button>

      <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
        Signing accepts the scope, pricing and terms above. We keep your name, email, signature,
        IP address and browser with a fingerprint of this exact proposal, and email you a signed
        PDF copy.
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
