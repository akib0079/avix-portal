import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Check, Circle, ArrowRight } from "lucide-react";

export type ChecklistState = {
  viewedProject: boolean;
  sentMessage: boolean;
  seenPayment: boolean;
  submittedRequest: boolean;
};

/**
 * "Getting started" card on the portal overview. Each step ticks itself off
 * from real data (they have a project, they've messaged us, …) and the whole
 * card disappears once everything's done.
 */
export function GettingStarted({ state }: { state: ChecklistState }) {
  const steps = [
    {
      done: state.viewedProject,
      label: "See your project's progress",
      hint: "Milestones, hours, and where things stand",
      href: "/portal/projects",
    },
    {
      done: state.sentMessage,
      label: "Say hi — chat with us",
      hint: "Message the team directly, any time",
      href: "/portal/messages",
    },
    {
      done: state.seenPayment,
      label: "Check how to pay",
      hint: "Our bank details, ready to copy",
      href: "/portal/payment",
    },
    {
      done: state.submittedRequest,
      label: "Need something extra?",
      hint: "Send us a task request",
      href: "/portal/requests",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // all done — card retires itself

  return (
    <Card className="mb-6 border-primary/20 bg-brand-tint/40">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">Getting started</h2>
          <span className="text-sm text-muted-foreground">
            {doneCount} of {steps.length} done
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A quick tour of what you can do here.
        </p>

        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {steps.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
                className={cn(
                  "group flex items-start gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/50",
                  step.done && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                    step.done
                      ? "bg-success text-white"
                      : "border-2 border-slate-300 text-transparent",
                  )}
                >
                  {step.done ? <Check className="size-3" /> : <Circle className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      step.done && "line-through",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.hint}</span>
                </span>
                {!step.done && (
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
