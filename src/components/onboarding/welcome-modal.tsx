"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/lib/actions/onboarding";
import { AvixBot } from "@/components/avix-bot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MessagesSquare, FolderKanban, CreditCard, ArrowRight, Check } from "lucide-react";

const STEPS = [
  {
    icon: FolderKanban,
    title: "Follow your project, live",
    body: "Every milestone we complete shows up here as it happens — with the hours we've put in and notes on how it's going. No more “any update?” emails.",
  },
  {
    icon: MessagesSquare,
    title: "Talk to us right here",
    body: "Use “Chat with us” in the sidebar any time — about a specific project, or just to ask something. It goes straight to the Avix Digital team, and we usually reply within one business day.",
  },
  {
    icon: CreditCard,
    title: "Invoices & paying us",
    body: "Invoices land under Invoices — view or download each one. “How to Pay” has our bank details ready to copy. Once you've paid, hit “I've sent the payment” and we'll confirm it.",
  },
];

/** First-login guide for a new client. Shows once, then never again. */
export function WelcomeModal({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  async function finish() {
    setBusy(true);
    await completeOnboarding();
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing any way (X / esc) still counts as seen.
        if (!next) void finish();
      }}
    >
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <div className="mb-2 flex justify-center">
            <AvixBot size={40} />
          </div>
          <DialogTitle className="font-heading text-center text-xl">
            {step === 0
              ? `Welcome, ${firstName || "there"} 👋`
              : current.title}
          </DialogTitle>
          <DialogDescription className="text-center">
            {step === 0
              ? "This is your Avix Digital portal. Three quick things to know."
              : "Your Avix Digital portal"}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-muted/30 p-5 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-tint text-primary">
            <current.icon className="size-5" />
          </div>
          {step === 0 && (
            <p className="font-heading mt-3 text-base font-semibold">{current.title}</p>
          )}
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{current.body}</p>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted",
              )}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={finish} disabled={busy}>
            Skip
          </Button>
          <Button
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            disabled={busy}
          >
            {isLast ? (
              <>
                <Check /> Got it
              </>
            ) : (
              <>
                Next <ArrowRight />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
