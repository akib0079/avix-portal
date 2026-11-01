import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createWithNextNumber } from "@/lib/invoice-number";
import { formColumns, itemRows, parseDate, type Refs } from "@/lib/invoice-write";
import { invoiceCopyDefaults } from "@/lib/invoice-copy";
import { dueDateFromTerms } from "@/lib/invoice-totals";
import { invoiceCopySourceSelect, toInvoiceCopySource } from "@/lib/dal/invoices";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";
import { sendInvoiceCore } from "@/lib/invoice-send";
import { renderPeriodTags, renderPeriodTagsInDoc } from "@/lib/merge-tags";
import { richTextToLines } from "@/lib/rich-text";
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/invoice";
import {
  MAX_RUNS_PER_PASS,
  advanceRun,
  dateToDay,
  dayIn,
  legacyNextRunDay,
  longDay,
  monthsBetween,
  nextRunDay,
  periodKey,
  periodVars,
  planEnd,
  previousRunDay,
  runAllowed,
  runInstant,
  shiftMonths,
  shiftMonthsInDoc,
  type Day,
  type Schedule,
} from "@/lib/recurring";

/**
 * The recurring-invoice engine: one run of a plan makes the invoice for one
 * period, exactly once. The duties engine calls it for every plan that is
 * due, and "Generate now" calls it for one plan, so both share the rules.
 *
 * A run is claimed by compare-and-set on nextRunAt inside the transaction
 * that creates its invoice: whoever moves nextRunAt on from the value it read
 * makes the invoice, and anyone else finds nothing to claim. The
 * (retainerId, retainerPeriod) unique index is the last guard, so a period
 * can't be invoiced twice even by two paths that both think it is theirs.
 * The old duty checked lastGeneratedPeriod outside its transaction, and a
 * double click on "Draft now" made two invoices.
 *
 * NO AUTHORIZATION HERE, like lib/invoice-write: the duty runs without a
 * session and the actions check requireAdmin before calling in.
 */

/** Everything a run reads about a plan, as one statement. */
export const planRunSelect = {
  id: true,
  title: true,
  clientId: true,
  projectId: true,
  amount: true,
  currency: true,
  paymentTermsDays: true,
  notes: true,
  frequency: true,
  interval: true,
  dayOfMonth: true,
  startDate: true,
  nextRunAt: true,
  endAfterCount: true,
  endDate: true,
  runCount: true,
  autoSend: true,
  active: true,
  lastGeneratedPeriod: true,
  lastRunError: true,
  client: { select: { status: true, firstName: true, lastName: true } },
  project: { select: { clientId: true } },
  templateInvoice: {
    select: { ...invoiceCopySourceSelect, retainerId: true, retainerPeriod: true },
  },
} satisfies Prisma.RetainerSelect;

export type PlanRun = Prisma.RetainerGetPayload<{ select: typeof planRunSelect }>;

/** Net terms on a plan's invoices when the plan sets none: the old fixed 14 days. */
const DEFAULT_TERMS_DAYS = 14;

/** Interactive, because the invoice is only created if the claim landed. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export function scheduleOf(plan: Pick<PlanRun, "frequency" | "interval" | "dayOfMonth">): Schedule {
  return { frequency: plan.frequency, interval: plan.interval, dayOfMonth: plan.dayOfMonth };
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function isPeriodTaken(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    JSON.stringify(err.meta ?? {}).includes("retainerPeriod")
  );
}

/** The template, when it can still stand for this plan's invoices. */
function usableTemplate(plan: PlanRun) {
  const template = plan.templateInvoice;
  if (!template || template.creditNoteForId) return null;
  // The plan decides who is billed. A template since moved to another client
  // would print that client's bill-to details.
  return template.clientId === plan.clientId ? template : null;
}

/** The plan's project, while it still belongs to the plan's client. */
function planProject(plan: PlanRun): string | null {
  if (!plan.projectId || !plan.project) return null;
  const owner = plan.project.clientId;
  return owner === null || owner === plan.clientId ? plan.projectId : null;
}

/**
 * The invoice a run on `day` makes, issued `issueDay`: a copy of the
 * template (lines, tax, notes, account, terms), its months moved on to this
 * period and its period tags filled in, or for a plan without one a single
 * line of the plan's title and amount in its currency and terms.
 */
function buildRunInput(
  plan: PlanRun,
  day: Day,
  issueDay: Day,
): { input: InvoiceInput; refs: Refs; warning: string | null } | { error: string } {
  const schedule = scheduleOf(plan);
  const vars = periodVars(day, schedule);
  const projectId = planProject(plan);
  const template = usableTemplate(plan);
  const warning =
    plan.templateInvoice && !template
      ? `${plan.templateInvoice.invoiceNumber} now bills another client, so the plan's own amount was used. Pick a new template.`
      : null;

  let input: InvoiceInput;
  if (template) {
    const copy = invoiceCopyDefaults(toInvoiceCopySource(template), { today: issueDay });
    if (!copy.ok) return { error: copy.error };
    // The template names its own period; every month it mentions moves on by
    // the distance from that period to this one. An issue date is a calendar
    // day stored at midnight UTC, so it is read as one, not in a time zone.
    const from =
      template.retainerId === plan.id && /^\d{4}-\d{2}$/.test(template.retainerPeriod ?? "")
        ? template.retainerPeriod!
        : periodKey(dateToDay(template.issueDate), "MONTH");
    const offset = plan.frequency === "MONTH" ? monthsBetween(from, day) : 0;
    const text = (value: string) => renderPeriodTags(shiftMonths(value, offset), vars);
    input = {
      ...copy.input,
      clientId: plan.clientId,
      projectId: projectId ?? "none",
      status: "DRAFT",
      // A plan's invoice is the plan's, not a duplicate of its template.
      duplicatedFromId: "",
      title: clip(text(copy.input.title ?? ""), 160),
      notes: clip(text(copy.input.notes ?? ""), 2000),
      items: (copy.input.items ?? []).map((item) => {
        const rich = item.descriptionRich
          ? renderPeriodTagsInDoc(shiftMonthsInDoc(item.descriptionRich, offset), vars)
          : null;
        // The plain text is re-derived from the document, as the form does,
        // so the two can't disagree.
        const plain = (rich ? richTextToLines(rich) : "") || text(item.description);
        return { ...item, descriptionRich: rich, description: clip(plain, 2000) };
      }),
    };
  } else {
    const label = `${plan.title} — ${vars.period}`;
    const amount = Number(plan.amount);
    const terms = plan.paymentTermsDays ?? DEFAULT_TERMS_DAYS;
    input = {
      clientId: plan.clientId,
      projectId: projectId ?? "none",
      invoiceNumber: "",
      title: clip(label, 160),
      currency: plan.currency,
      items: [{ description: clip(label, 2000), descriptionRich: null, qty: 1, rate: amount }],
      amount,
      // A dollar plan's invoice is worth its total; any other currency waits
      // for the value it settles at. The plan's own USD value is for MRR.
      amountUsd: null,
      discount: 0,
      taxRate: null,
      taxLabel: "",
      paymentTermsDays: terms,
      status: "DRAFT",
      issueDate: issueDay,
      dueDate: dueDateFromTerms(issueDay, terms) ?? "",
      notes: clip(renderPeriodTags(plan.notes ?? "", vars), 2000),
      billToCompany: "",
      billToAddress: "",
      billToEmail: "",
      paymentAccountId: "none",
      payLinkUrl: "",
      pdfExternalUrl: "",
      duplicatedFromId: "",
    };
  }

  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: `The invoice for ${vars.period} couldn't be drafted: ${parsed.error.issues[0]?.message ?? "invalid template"}.`,
    };
  }
  const accountId = parsed.data.paymentAccountId;
  return {
    input: parsed.data,
    refs: {
      customNumber: null,
      issueDate: parseDate(issueDay)!,
      projectId,
      paymentAccountId: accountId && accountId !== "none" ? accountId : null,
      duplicatedFromId: null,
    },
    warning,
  };
}

/** How a run's claim is made. */
type Claim =
  /** The run nextRunAt points at: moving nextRunAt on from `seen` claims it. */
  | { kind: "scheduled"; seen: Date }
  /** A period the schedule passed without an invoice, made by hand. */
  | { kind: "fill" };

type RunOutcome =
  | {
      kind: "created";
      invoice: { id: string; invoiceNumber: string };
      period: string;
      /** This was the plan's last invoice. */
      finished: boolean;
    }
  /** Another run claimed it first. */
  | { kind: "taken" }
  /** The period already has its invoice. */
  | { kind: "exists" }
  | { kind: "invalid"; error: string };

/** What a pass knows about the plan as it goes: the row it read goes stale. */
type RunState = { runCount: number; lastGeneratedPeriod: string | null };

/**
 * Makes the invoice for a run on `day`, issued `issueDay`, and moves the plan
 * on, in one transaction: if the claim doesn't land, nothing is created.
 */
async function createRunInvoice(
  plan: PlanRun,
  day: Day,
  claim: Claim,
  ctx: { timeZone: string; now: Date; issueDay: Day; state: RunState },
): Promise<RunOutcome> {
  const built = buildRunInput(plan, day, ctx.issueDay);
  if ("error" in built) return { kind: "invalid", error: built.error };
  const columns = formColumns(built.input, built.refs);
  const period = periodKey(day, plan.frequency);
  const nextDay = nextRunDay(day, scheduleOf(plan));
  const after = { ...planEnd(plan), runCount: ctx.state.runCount + 1 };
  // A scheduled run ends the plan when the run after it is not allowed; a
  // filled-in period only when it used up the plan's count.
  const finished =
    claim.kind === "scheduled"
      ? !runAllowed(nextDay, after)
      : after.endAfterCount != null && after.runCount >= after.endAfterCount;

  const planData: Prisma.RetainerUpdateManyMutationInput = {
    runCount: { increment: 1 },
    lastRunAt: ctx.now,
    lastRunError: built.warning,
    // Kept for monthly plans, which older code and reports read.
    ...(plan.frequency === "MONTH" &&
    (!ctx.state.lastGeneratedPeriod || period > ctx.state.lastGeneratedPeriod)
      ? { lastGeneratedPeriod: period }
      : {}),
    ...(finished
      ? { active: false, nextRunAt: null }
      : claim.kind === "scheduled"
        ? { nextRunAt: runInstant(nextDay, ctx.timeZone) }
        : {}),
  };

  try {
    const invoice = await createWithNextNumber(prisma, (invoiceNumber) =>
      prisma.$transaction(async (tx) => {
        const claimed = await tx.retainer.updateMany({
          where:
            claim.kind === "scheduled"
              ? { id: plan.id, active: true, nextRunAt: claim.seen }
              : { id: plan.id, active: true },
          data: planData,
        });
        if (claimed.count === 0) return null;
        return tx.invoice.create({
          data: {
            invoiceNumber,
            ...columns,
            // Always a draft: one that sends itself is sent once this commits,
            // and stays a draft the client can't see if that fails.
            status: "DRAFT",
            retainerId: plan.id,
            retainerPeriod: period,
            items: { create: itemRows(built.input.items) },
          },
          select: { id: true, invoiceNumber: true },
        });
      }, TX_OPTIONS),
    );
    if (!invoice) return { kind: "taken" };
    ctx.state.runCount++;
    if (planData.lastGeneratedPeriod) ctx.state.lastGeneratedPeriod = period;
    return { kind: "created", invoice, period, finished };
  } catch (err) {
    if (isPeriodTaken(err)) return { kind: "exists" };
    throw err;
  }
}

/**
 * A plan made before schedules has no nextRunAt: give it one, where it
 * would have drafted next (legacyNextRunDay), claimed the same way a run is.
 */
async function initialiseLegacy(plan: PlanRun, timeZone: string, today: Day): Promise<Date | null> {
  const at = runInstant(legacyNextRunDay(plan, today), timeZone);
  const claimed = await prisma.retainer.updateMany({
    where: { id: plan.id, active: true, nextRunAt: null },
    data: { nextRunAt: at },
  });
  return claimed.count > 0 ? at : null;
}

export type PlanPass = {
  plan: PlanRun;
  created: { id: string; invoiceNumber: string; period: string }[];
  /** More than one period was due: every invoice of this pass is a draft. */
  catchUp: boolean;
  /** The plan made its last invoice, or found it had none left. */
  finished: boolean;
  error: string | null;
};

/**
 * Makes every invoice a plan has due, oldest first, at most
 * MAX_RUNS_PER_PASS at a time (the next pass carries on). Each is labelled
 * for its own period and issued today.
 */
export async function runDuePlan(plan: PlanRun, now: Date, timeZone: string): Promise<PlanPass> {
  const pass: PlanPass = { plan, created: [], catchUp: false, finished: false, error: null };
  const today = dayIn(now, timeZone);
  let seen = plan.nextRunAt ?? (await initialiseLegacy(plan, timeZone, today));
  if (!seen || seen > now) return pass;

  const schedule = scheduleOf(plan);
  pass.catchUp = advanceRun(seen, schedule, timeZone) <= now;
  const state: RunState = {
    runCount: plan.runCount,
    lastGeneratedPeriod: plan.lastGeneratedPeriod,
  };

  for (let i = 0; i < MAX_RUNS_PER_PASS && seen <= now; i++) {
    const day = dayIn(seen, timeZone);
    const nextDay = nextRunDay(day, schedule);
    const end = { ...planEnd(plan), runCount: state.runCount };

    // An end set after this run was scheduled: nothing more to make.
    if (!runAllowed(day, end)) {
      await prisma.retainer.updateMany({
        where: { id: plan.id, active: true, nextRunAt: seen },
        data: { active: false, nextRunAt: null },
      });
      pass.finished = true;
      break;
    }

    let outcome: RunOutcome;
    try {
      outcome = await createRunInvoice(plan, day, { kind: "scheduled", seen }, {
        timeZone,
        now,
        issueDay: today,
        state,
      });
    } catch (err) {
      // Nothing was claimed (the claim and the invoice commit together), so
      // the next pass tries this run again.
      console.error(`[recurring] plan ${plan.id} run failed:`, (err as Error).message);
      pass.error = `The invoice for ${periodVars(day, schedule).period} couldn't be drafted. It will be tried again on the next run.`;
      break;
    }
    if (outcome.kind === "taken") break;
    if (outcome.kind === "invalid") {
      pass.error = outcome.error;
      break;
    }
    if (outcome.kind === "exists") {
      // Already invoiced (moved back over by an edit, say): step past it.
      const ends = !runAllowed(nextDay, end);
      const moved = await prisma.retainer.updateMany({
        where: { id: plan.id, active: true, nextRunAt: seen },
        data: ends
          ? { active: false, nextRunAt: null, lastRunAt: now }
          : { nextRunAt: runInstant(nextDay, timeZone), lastRunAt: now },
      });
      if (moved.count === 0) break;
      if (ends) {
        pass.finished = true;
        break;
      }
    } else {
      pass.created.push({ ...outcome.invoice, period: outcome.period });
      if (outcome.finished) {
        pass.finished = true;
        break;
      }
    }
    seen = runInstant(nextDay, timeZone);
  }
  return pass;
}

/**
 * The plan's invoice sends itself: after its draft is committed, never for a
 * catch-up (a backdated invoice needs a person to look at it), and only to a
 * client whose account is active. A failed send leaves the draft and says
 * why on the plan.
 */
async function autoSend(pass: PlanPass): Promise<"sent" | "failed" | null> {
  const { plan } = pass;
  if (!plan.autoSend || pass.catchUp || pass.created.length !== 1) return null;
  const invoice = pass.created[0];
  const result =
    plan.client.status === "ACTIVE"
      ? await sendInvoiceCore(invoice.id)
      : { ok: false as const, error: "The client's account is inactive." };
  if (result.ok) return "sent";
  pass.error = `${invoice.invoiceNumber} wasn't sent automatically: ${result.error} It's waiting as a draft.`;
  return "failed";
}

/** A run problem, kept on the plan and told to the admins once, not every pass. */
async function reportError(plan: PlanRun, message: string, link: string): Promise<void> {
  if (plan.lastRunError === message) return;
  await Promise.all([
    prisma.retainer.update({ where: { id: plan.id }, data: { lastRunError: message } }),
    notifyAllAdmins({
      type: "RECURRING_INVOICE_FAILED",
      title: `Recurring plan “${plan.title}” needs you`,
      body: message,
      link,
    }),
  ]);
}

export type PlanResult = PlanPass & { sent: boolean };

/**
 * One plan's due runs, its auto-send and its record: an activity entry per
 * invoice, the error if any. What the admins are told about a batch of
 * plans is the caller's (summarisePlanResults), so a duty run sends one
 * summary rather than a bell per plan.
 */
export async function processDuePlan(
  plan: PlanRun,
  now: Date,
  timeZone: string,
): Promise<PlanResult> {
  let pass: PlanPass;
  try {
    pass = await runDuePlan(plan, now, timeZone);
  } catch (err) {
    // A failed claim or bookkeeping write: nothing half-made to report.
    console.error(`[recurring] plan ${plan.id} failed:`, (err as Error).message);
    pass = {
      plan,
      created: [],
      catchUp: false,
      finished: false,
      error: "The last run failed unexpectedly. It will be tried again on the next run.",
    };
  }
  const sent = (await autoSend(pass)) === "sent";

  await Promise.all([
    ...pass.created.map((invoice) =>
      logActivity({
        type: "invoice.drafted",
        summary: `Recurring invoice ${invoice.invoiceNumber} drafted — ${plan.title}`,
        clientId: plan.clientId,
        projectId: plan.projectId,
        entity: "invoice",
        entityId: invoice.id,
        link: `/admin/invoices/${invoice.id}`,
      }),
    ),
    pass.error
      ? reportError(
          plan,
          pass.error,
          pass.created[0] ? `/admin/invoices/${pass.created[0].id}` : "/admin/retainers",
        )
      : null,
  ]);
  return { ...pass, sent };
}

/** Tells the admins what a batch of plan passes did, in a few bells at most. */
export async function summarisePlanResults(results: PlanResult[]): Promise<void> {
  const drafted = results
    .filter((r) => !r.sent)
    .reduce((n, r) => n + r.created.length, 0);
  const sent = results.filter((r) => r.sent).length;
  const notes: Promise<unknown>[] = [];
  if (drafted > 0) {
    notes.push(
      notifyAllAdmins({
        type: "RETAINER_GENERATED",
        title: `${drafted} recurring invoice${drafted === 1 ? "" : "s"} drafted`,
        body: "Review and send them from Invoices.",
        link: "/admin/invoices?filter=draft",
      }),
    );
  }
  if (sent > 0) {
    notes.push(
      notifyAllAdmins({
        type: "RETAINER_GENERATED",
        title: `${sent} recurring invoice${sent === 1 ? "" : "s"} sent to clients`,
        body: "They went out on schedule. Payments are tracked as usual.",
        link: "/admin/invoices?filter=recurring",
      }),
    );
  }
  for (const r of results) {
    if (r.catchUp && r.created.length > 0) {
      notes.push(
        notifyAllAdmins({
          type: "RETAINER_GENERATED",
          title: `Missed periods of “${r.plan.title}” drafted`,
          body: `${r.created.map((i) => i.invoiceNumber).join(", ")} cover periods the schedule missed. Check their dates before sending.`,
          link: "/admin/invoices?filter=draft",
        }),
      );
    }
    if (r.finished) {
      notes.push(
        notifyAllAdmins({
          type: "RETAINER_GENERATED",
          title: `“${r.plan.title}” has finished`,
          body: r.created.length
            ? `Its last invoice was ${r.created[r.created.length - 1].invoiceNumber}. Nothing more will be drafted.`
            : "It reached its end. Nothing more will be drafted.",
          link: "/admin/retainers",
        }),
      );
    }
  }
  await Promise.all(notes);
}

export type GenerateNowResult =
  | { ok: true; created: { id: string; invoiceNumber: string; period: string }[] }
  | { ok: false; error: string };

/**
 * "Generate now": this period's invoice, today, without waiting for the
 * schedule. In order:
 *  1. runs already due are made as the duty would make them (as drafts);
 *  2. a run later in the current month (or week) is brought forward;
 *  3. a period the schedule passed with no invoice (skipped, paused, or its
 *     draft deleted) is filled in, leaving the schedule as it is;
 *  4. otherwise this period is already invoiced, and nothing is made.
 * Each path claims its run like the duty does, so a double click makes one.
 * Never sends: the owner is right there to look at it.
 */
export async function generatePlanNow(
  plan: PlanRun,
  now: Date,
  timeZone: string,
): Promise<GenerateNowResult> {
  if (!plan.active) return { ok: false, error: "This plan is paused. Resume it first." };
  const today = dayIn(now, timeZone);
  const seen = plan.nextRunAt ?? (await initialiseLegacy(plan, timeZone, today));
  if (!seen) return { ok: false, error: "The plan just changed. Refresh and try again." };

  if (seen <= now) {
    const pass = await runDuePlan({ ...plan, nextRunAt: seen }, now, timeZone);
    if (pass.error) return { ok: false, error: pass.error };
    if (pass.created.length > 0) return { ok: true, created: pass.created };
    return { ok: false, error: "This period's invoice was just drafted." };
  }

  const schedule = scheduleOf(plan);
  const state: RunState = { runCount: plan.runCount, lastGeneratedPeriod: plan.lastGeneratedPeriod };
  const ctx = { timeZone, now, issueDay: today, state };
  const nextDay = dayIn(seen, timeZone);
  const current = periodKey(today, plan.frequency);

  let outcome: RunOutcome | null = null;
  if (periodKey(nextDay, plan.frequency) === current) {
    outcome = await createRunInvoice(plan, nextDay, { kind: "scheduled", seen }, ctx);
  } else {
    const previous = previousRunDay(nextDay, schedule);
    const startDay = plan.startDate ? dateToDay(plan.startDate) : null;
    if (periodKey(previous, plan.frequency) <= current && (!startDay || previous >= startDay)) {
      outcome = await createRunInvoice(plan, previous, { kind: "fill" }, ctx);
    }
  }

  if (outcome?.kind === "created") {
    return { ok: true, created: [{ ...outcome.invoice, period: outcome.period }] };
  }
  if (outcome?.kind === "invalid") return { ok: false, error: outcome.error };
  if (outcome?.kind === "taken") {
    return { ok: false, error: "This period's invoice was just drafted." };
  }
  return {
    ok: false,
    error: `This period is already invoiced. The next invoice is due on ${longDay(nextDay)}.`,
  };
}

/**
 * Runs one plan now if it is due: a plan saved with today as its next date
 * shouldn't wait for the duties' 15-minute throttle. For after().
 */
export async function runPlanIfDue(planId: string, timeZone: string): Promise<void> {
  try {
    const now = new Date();
    const plan = await prisma.retainer.findFirst({
      where: { id: planId, active: true, nextRunAt: { lte: now } },
      select: planRunSelect,
    });
    if (!plan) return;
    await summarisePlanResults([await processDuePlan(plan, now, timeZone)]);
  } catch (err) {
    console.error("[recurring] immediate run failed:", (err as Error).message);
  }
}
