"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import { logActivity } from "@/lib/dal/activity";
import { usdToStore } from "@/lib/invoice-usd";
import {
  repeatSchema,
  retainerSchema,
  type RepeatInput,
  type RetainerInput,
  type ScheduleInput,
} from "@/lib/validation/retainer";
import {
  anchorDay,
  cadenceLabel,
  dateToDay,
  dayIn,
  dayToDate,
  legacyNextRunDay,
  longDay,
  nextRunDay,
  periodKey,
  periodVars,
  planEnd,
  planState,
  rollForward,
  runAllowed,
  runInstant,
  type Day,
} from "@/lib/recurring";
import { generatePlanNow, planRunSelect, runPlanIfDue, scheduleOf } from "@/lib/recurring-run";

/**
 * Recurring plans (Retainer rows, "Recurring" in the UI): creating and
 * editing them, pausing, skipping, "Generate now", and making an invoice
 * repeat. Every one is ADMIN only: plans are money, and STAFF never see them.
 * The schedule itself lives in lib/recurring and the runs in
 * lib/recurring-run, which the duties engine shares.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Every page that shows a plan, a plan's invoice or the money it brings. */
function revalidatePlans() {
  revalidatePath("/admin/retainers");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/invoices/[id]", "page");
  revalidatePath("/admin");
}

/** The client and project a plan bills, checked in one wave. */
async function resolvePlanRefs(data: {
  clientId: string;
  projectId: string;
}): Promise<{ clientId: string; projectId: string | null } | { error: string }> {
  const [client, project] = await Promise.all([
    prisma.user.findFirst({ where: { id: data.clientId, role: "CLIENT" }, select: { id: true } }),
    data.projectId === "none"
      ? null
      : prisma.project.findFirst({
          where: { id: data.projectId, clientId: data.clientId },
          select: { id: true },
        }),
  ]);
  if (!client) return { error: "Client not found." };
  if (data.projectId !== "none" && !project) return { error: "Project not found for that client." };
  return { clientId: client.id, projectId: project?.id ?? null };
}

/**
 * The columns a schedule writes. A monthly plan bills on its next date's day
 * from then on, unless that date is the one it already had: a plan on the
 * 31st whose next run is 28 February keeps 31 as its day.
 */
function scheduleColumns(schedule: ScheduleInput, timeZone: string, keepDayOfMonth?: number) {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    dayOfMonth: keepDayOfMonth ?? anchorDay(schedule.nextDate),
    nextRunAt: runInstant(schedule.nextDate, timeZone),
    endAfterCount: schedule.ends === "after" ? (schedule.endAfterCount ?? null) : null,
    endDate: schedule.ends === "on" && schedule.endDate ? dayToDate(schedule.endDate) : null,
    autoSend: schedule.autoSend,
  };
}

/**
 * What's wrong with a schedule, given where the plan stands: a next date in
 * the past (unless it is the one already stored, on a plan running behind),
 * a first invoice in the period its template already covers, or an end the
 * plan has already passed.
 */
function scheduleError(
  schedule: ScheduleInput,
  ctx: { today: Day; runCount: number; storedDay?: Day | null; coveredPeriod?: string },
): string | null {
  if (schedule.nextDate < ctx.today && schedule.nextDate !== ctx.storedDay) {
    return "Pick today or a later date for the next invoice.";
  }
  const unit = schedule.frequency === "WEEK" ? "week" : "month";
  if (ctx.coveredPeriod && periodKey(schedule.nextDate, schedule.frequency) <= ctx.coveredPeriod) {
    return `This invoice already covers that ${unit}. Start the plan in a later ${unit}.`;
  }
  const end = {
    endAfterCount: schedule.ends === "after" ? (schedule.endAfterCount ?? null) : null,
    endDay: schedule.ends === "on" ? schedule.endDate || null : null,
    runCount: ctx.runCount,
  };
  if (!runAllowed(schedule.nextDate, end)) {
    return schedule.ends === "after"
      ? `This plan has made ${ctx.runCount} invoice${ctx.runCount === 1 ? "" : "s"} already. Pick a number above ${ctx.runCount}.`
      : "The end date is before the next invoice.";
  }
  return null;
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/** The plan's own invoice for the period of `day`, if it already has one. */
function invoiceForPeriod(planId: string, schedule: ScheduleInput) {
  return prisma.invoice.findFirst({
    where: { retainerId: planId, retainerPeriod: periodKey(schedule.nextDate, schedule.frequency) },
    select: { invoiceNumber: true },
  });
}

function dueNow(nextDate: Day, timeZone: string): boolean {
  return runInstant(nextDate, timeZone).getTime() <= Date.now();
}

/** A new plan from the Recurring page: one line of its title and amount per invoice. */
export async function createRetainer(input: RetainerInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;

  const [refs, booking] = await Promise.all([resolvePlanRefs(data), getBookingConfig()]);
  if ("error" in refs) return { ok: false, error: refs.error };
  const timeZone = booking.agencyTimezone;
  const problem = scheduleError(data.schedule, { today: dayIn(new Date(), timeZone), runCount: 0 });
  if (problem) return { ok: false, error: problem };

  const plan = await prisma.retainer.create({
    data: {
      title: data.title,
      ...refs,
      amount: data.amount,
      currency: data.currency,
      amountUsd: usdToStore(data.currency, data.amount, data.amountUsd),
      paymentTermsDays: data.paymentTermsDays ?? null,
      notes: data.notes || null,
      active: data.active,
      ...scheduleColumns(data.schedule, timeZone),
      startDate: dayToDate(data.schedule.nextDate),
    },
    select: { id: true },
  });
  if (data.active && dueNow(data.schedule.nextDate, timeZone)) {
    after(() => runPlanIfDue(plan.id, timeZone));
  }
  revalidatePlans();
  return { ok: true };
}

/**
 * The full edit from the Recurring page. A plan that copies a template takes
 * its amount, currency and terms from it (they are re-read here, so MRR
 * follows the template), and keeps the template's client.
 */
export async function updateRetainer(id: string, input: RetainerInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;

  const [existing, refs, booking, taken] = await Promise.all([
    prisma.retainer.findUnique({
      where: { id },
      select: {
        id: true,
        nextRunAt: true,
        dayOfMonth: true,
        startDate: true,
        runCount: true,
        templateInvoice: {
          select: {
            invoiceNumber: true,
            clientId: true,
            amount: true,
            currency: true,
            amountUsd: true,
            paymentTermsDays: true,
          },
        },
      },
    }),
    resolvePlanRefs(data),
    getBookingConfig(),
    invoiceForPeriod(id, data.schedule),
  ]);
  if (!existing) return { ok: false, error: "Plan not found." };
  if ("error" in refs) return { ok: false, error: refs.error };
  const template = existing.templateInvoice;
  if (template && template.clientId !== refs.clientId) {
    return {
      ok: false,
      error: `This plan copies ${template.invoiceNumber}, which bills its current client. Make a new plan for the other client instead.`,
    };
  }

  const timeZone = booking.agencyTimezone;
  const storedDay = existing.nextRunAt ? dayIn(existing.nextRunAt, timeZone) : null;
  const problem = scheduleError(data.schedule, {
    today: dayIn(new Date(), timeZone),
    runCount: existing.runCount,
    storedDay,
  });
  if (problem) return { ok: false, error: problem };
  if (taken && data.schedule.nextDate !== storedDay) {
    return {
      ok: false,
      error: `${periodVars(data.schedule.nextDate, { ...data.schedule, dayOfMonth: 1 }).period} already has ${taken.invoiceNumber}. Pick a date in a later period.`,
    };
  }

  const money = template
    ? {
        amount: template.amount,
        currency: template.currency,
        amountUsd: usdToStore(
          template.currency,
          Number(template.amount),
          template.amountUsd == null ? null : Number(template.amountUsd),
        ),
        paymentTermsDays: template.paymentTermsDays,
      }
    : {
        amount: data.amount,
        currency: data.currency,
        amountUsd: usdToStore(data.currency, data.amount, data.amountUsd),
        paymentTermsDays: data.paymentTermsDays ?? null,
      };
  const startDay = existing.startDate ? dateToDay(existing.startDate) : null;

  await prisma.retainer.update({
    where: { id },
    data: {
      title: data.title,
      ...refs,
      ...money,
      notes: data.notes || null,
      active: data.active,
      ...scheduleColumns(
        data.schedule,
        timeZone,
        data.schedule.nextDate === storedDay ? existing.dayOfMonth : undefined,
      ),
      ...(startDay && startDay <= data.schedule.nextDate
        ? {}
        : { startDate: dayToDate(data.schedule.nextDate) }),
    },
  });
  if (data.active && dueNow(data.schedule.nextDate, timeZone)) {
    after(() => runPlanIfDue(id, timeZone));
  }
  revalidatePlans();
  return { ok: true };
}

/**
 * The invoice page's Edit: the plan's name and its schedule. A paused plan
 * stays paused; one that had ended starts again with the new schedule.
 */
export async function updatePlanSchedule(id: string, input: RepeatInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = repeatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { title, schedule } = parsed.data;

  const [existing, booking, taken] = await Promise.all([
    prisma.retainer.findUnique({
      where: { id },
      select: {
        active: true,
        nextRunAt: true,
        dayOfMonth: true,
        startDate: true,
        runCount: true,
        endAfterCount: true,
        endDate: true,
      },
    }),
    getBookingConfig(),
    invoiceForPeriod(id, schedule),
  ]);
  if (!existing) return { ok: false, error: "Plan not found." };
  const timeZone = booking.agencyTimezone;
  const storedDay = existing.nextRunAt ? dayIn(existing.nextRunAt, timeZone) : null;
  const problem = scheduleError(schedule, {
    today: dayIn(new Date(), timeZone),
    runCount: existing.runCount,
    storedDay,
  });
  if (problem) return { ok: false, error: problem };
  if (taken && schedule.nextDate !== storedDay) {
    return {
      ok: false,
      error: `${periodVars(schedule.nextDate, { ...schedule, dayOfMonth: 1 }).period} already has ${taken.invoiceNumber}. Pick a date in a later period.`,
    };
  }

  const restart = planState(existing) === "ended";
  const startDay = existing.startDate ? dateToDay(existing.startDate) : null;
  await prisma.retainer.update({
    where: { id },
    data: {
      title,
      ...scheduleColumns(
        schedule,
        timeZone,
        schedule.nextDate === storedDay ? existing.dayOfMonth : undefined,
      ),
      ...(startDay && startDay <= schedule.nextDate ? {} : { startDate: dayToDate(schedule.nextDate) }),
      ...(restart ? { active: true } : {}),
    },
  });
  if ((existing.active || restart) && dueNow(schedule.nextDate, timeZone)) {
    after(() => runPlanIfDue(id, timeZone));
  }
  revalidatePlans();
  return { ok: true };
}

/**
 * Pause keeps the plan's next date. Resume picks up at the first run from
 * today: the periods it was paused for stay unbilled (Generate now fills in
 * the current one if it should be billed after all).
 */
export async function setRetainerActive(
  id: string,
  active: boolean,
): Promise<ActionResult<{ nextDay: Day | null }>> {
  await requireAdmin();
  if (!active) {
    const paused = await prisma.retainer.updateMany({ where: { id }, data: { active: false } });
    if (paused.count === 0) return { ok: false, error: "Plan not found." };
    revalidatePlans();
    return { ok: true, data: { nextDay: null } };
  }

  const [plan, booking] = await Promise.all([
    prisma.retainer.findUnique({
      where: { id },
      select: {
        active: true,
        frequency: true,
        interval: true,
        dayOfMonth: true,
        nextRunAt: true,
        endAfterCount: true,
        endDate: true,
        runCount: true,
        lastGeneratedPeriod: true,
      },
    }),
    getBookingConfig(),
  ]);
  if (!plan) return { ok: false, error: "Plan not found." };
  if (plan.active) return { ok: true, data: { nextDay: null } };
  const ended = "This plan has ended. Edit it to set a later end, and it starts again.";
  if (planState(plan) === "ended") return { ok: false, error: ended };

  const timeZone = booking.agencyTimezone;
  const today = dayIn(new Date(), timeZone);
  const from = plan.nextRunAt ? dayIn(plan.nextRunAt, timeZone) : legacyNextRunDay(plan, today);
  const day = rollForward(from, scheduleOf(plan), today);
  if (!runAllowed(day, planEnd(plan))) return { ok: false, error: ended };

  const resumed = await prisma.retainer.updateMany({
    where: { id, active: false },
    data: { active: true, nextRunAt: runInstant(day, timeZone) },
  });
  if (resumed.count === 0) return { ok: false, error: "The plan just changed. Refresh and try again." };
  if (dueNow(day, timeZone)) after(() => runPlanIfDue(id, timeZone));
  revalidatePlans();
  return { ok: true, data: { nextDay: day } };
}

/** Skip the next invoice: the schedule moves on a period, and nothing is made for it. */
export async function skipNextRun(
  id: string,
): Promise<ActionResult<{ skipped: Day; nextDay: Day | null }>> {
  await requireAdmin();
  const [plan, booking] = await Promise.all([
    prisma.retainer.findUnique({
      where: { id },
      select: {
        active: true,
        frequency: true,
        interval: true,
        dayOfMonth: true,
        nextRunAt: true,
        endAfterCount: true,
        endDate: true,
        runCount: true,
        lastGeneratedPeriod: true,
      },
    }),
    getBookingConfig(),
  ]);
  if (!plan) return { ok: false, error: "Plan not found." };
  if (!plan.active) return { ok: false, error: "A paused plan has nothing to skip. Resume it first." };

  const timeZone = booking.agencyTimezone;
  const day = plan.nextRunAt
    ? dayIn(plan.nextRunAt, timeZone)
    : legacyNextRunDay(plan, dayIn(new Date(), timeZone));
  const next = nextRunDay(day, scheduleOf(plan));
  const ends = !runAllowed(next, planEnd(plan));
  // Compare-and-set like a run: a run that took this one first wins.
  const skipped = await prisma.retainer.updateMany({
    where: { id, active: true, nextRunAt: plan.nextRunAt },
    data: ends ? { active: false, nextRunAt: null } : { nextRunAt: runInstant(next, timeZone) },
  });
  if (skipped.count === 0) {
    return { ok: false, error: "The plan just changed. Refresh and try again." };
  }
  revalidatePlans();
  return { ok: true, data: { skipped: day, nextDay: ends ? null : next } };
}

/**
 * "Generate now": this period's invoice, today, through the same run the
 * schedule uses (lib/recurring-run generatePlanNow), so a double click makes
 * one invoice, not two. Always a draft.
 */
export async function generateRetainerInvoice(
  id: string,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string; count: number }>> {
  await requireAdmin();
  const [plan, booking] = await Promise.all([
    prisma.retainer.findUnique({ where: { id }, select: planRunSelect }),
    getBookingConfig(),
  ]);
  if (!plan) return { ok: false, error: "Plan not found." };

  const result = await generatePlanNow(plan, new Date(), booking.agencyTimezone);
  if (!result.ok) return result;

  after(() =>
    Promise.all(
      result.created.map((invoice) =>
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
    ),
  );
  revalidatePlans();
  const last = result.created[result.created.length - 1];
  return {
    ok: true,
    data: { invoiceId: last.id, invoiceNumber: last.invoiceNumber, count: result.created.length },
  };
}

/**
 * "Make recurring" on an invoice: a plan that copies this invoice for each
 * new period. The invoice itself becomes the plan's first (it keeps its own
 * period, and counts toward "after N invoices"), and its template.
 */
export async function makeInvoiceRecurring(
  invoiceId: string,
  input: RepeatInput,
): Promise<ActionResult<{ planId: string }>> {
  await requireAdmin();
  const parsed = repeatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { title, schedule } = parsed.data;

  const [invoice, booking] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        clientId: true,
        projectId: true,
        amount: true,
        currency: true,
        amountUsd: true,
        paymentTermsDays: true,
        issueDate: true,
        status: true,
        retainerId: true,
        creditNoteForId: true,
      },
    }),
    getBookingConfig(),
  ]);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.creditNoteForId) return { ok: false, error: "A credit note can't repeat." };
  if (invoice.status === "CANCELLED") {
    return { ok: false, error: "This invoice is cancelled. Duplicate it and make the copy recurring." };
  }
  const already = "This invoice is already part of a recurring plan.";
  if (invoice.retainerId) return { ok: false, error: already };

  const timeZone = booking.agencyTimezone;
  const own = periodKey(dateToDay(invoice.issueDate), schedule.frequency);
  const problem = scheduleError(schedule, {
    today: dayIn(new Date(), timeZone),
    runCount: 1,
    coveredPeriod: own,
  });
  if (problem) return { ok: false, error: problem };

  const amount = Number(invoice.amount);
  let planId: string | null;
  try {
    // One statement: the plan is created through the invoice, which joins
    // it, so neither can exist without the other. The where clause is the
    // guard against a plan made from another tab meanwhile.
    const updated = await prisma.invoice.update({
      where: { id: invoice.id, retainerId: null },
      data: {
        retainerPeriod: own,
        retainer: {
          create: {
            clientId: invoice.clientId,
            projectId: invoice.projectId,
            title,
            amount,
            currency: invoice.currency,
            amountUsd: usdToStore(
              invoice.currency,
              amount,
              invoice.amountUsd == null ? null : Number(invoice.amountUsd),
            ),
            paymentTermsDays: invoice.paymentTermsDays,
            active: true,
            ...scheduleColumns(schedule, timeZone),
            startDate: dayToDate(schedule.nextDate),
            runCount: 1,
            lastGeneratedPeriod: schedule.frequency === "MONTH" ? own : null,
            templateInvoiceId: invoice.id,
          },
        },
      },
      select: { retainerId: true },
    });
    planId = updated.retainerId;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: already };
    }
    throw err;
  }
  if (!planId) return { ok: false, error: already };

  const createdPlan = planId;
  if (dueNow(schedule.nextDate, timeZone)) after(() => runPlanIfDue(createdPlan, timeZone));
  after(() =>
    logActivity({
      type: "invoice.recurring",
      summary: `${invoice.invoiceNumber} now repeats ${cadenceLabel(schedule).toLowerCase()} — ${title}, first on ${longDay(schedule.nextDate)}`,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      entity: "invoice",
      entityId: invoice.id,
      link: `/admin/invoices/${invoice.id}`,
    }),
  );
  revalidatePlans();
  return { ok: true, data: { planId: createdPlan } };
}

/**
 * "Use this as the template": the plan copies this invoice from its next
 * period on. Only one of the plan's own invoices, for the same client, and
 * never a credit note or a cancelled one. The plan's amount follows it.
 */
export async function usePlanTemplate(invoiceId: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      clientId: true,
      amount: true,
      currency: true,
      amountUsd: true,
      paymentTermsDays: true,
      status: true,
      creditNoteForId: true,
      retainer: { select: { id: true, clientId: true, templateInvoiceId: true } },
    },
  });
  if (!invoice?.retainer) return { ok: false, error: "This invoice isn't part of a recurring plan." };
  if (invoice.creditNoteForId || invoice.status === "CANCELLED") {
    return { ok: false, error: "A cancelled invoice or a credit note can't be the template." };
  }
  if (invoice.retainer.clientId !== invoice.clientId) {
    return { ok: false, error: "This invoice bills another client than its plan." };
  }
  if (invoice.retainer.templateInvoiceId === invoice.id) return { ok: true };

  const amount = Number(invoice.amount);
  await prisma.retainer.update({
    where: { id: invoice.retainer.id },
    data: {
      templateInvoiceId: invoice.id,
      amount,
      currency: invoice.currency,
      amountUsd: usdToStore(
        invoice.currency,
        amount,
        invoice.amountUsd == null ? null : Number(invoice.amountUsd),
      ),
      paymentTermsDays: invoice.paymentTermsDays,
    },
  });
  revalidatePlans();
  return { ok: true };
}

/**
 * Attach an EXISTING invoice to a plan — the "add" half of add-or-generate.
 * Only invoices belonging to the plan's own client can be linked, so a plan
 * can never claim another client's money. An attached invoice has no period:
 * it never stops the schedule from making that period's invoice.
 */
export async function attachInvoiceToRetainer(
  retainerId: string,
  invoiceId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const [retainer, invoice] = await Promise.all([
    prisma.retainer.findUnique({
      where: { id: retainerId },
      select: { id: true, clientId: true },
    }),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, clientId: true, retainerId: true, creditNoteForId: true },
    }),
  ]);
  if (!retainer) return { ok: false, error: "Plan not found." };
  if (!invoice || invoice.clientId !== retainer.clientId || invoice.creditNoteForId) {
    return { ok: false, error: "Invoice not found for this plan's client." };
  }
  if (invoice.retainerId && invoice.retainerId !== retainerId) {
    return { ok: false, error: "That invoice is already linked to another plan." };
  }

  await prisma.invoice.update({ where: { id: invoice.id }, data: { retainerId } });
  revalidatePlans();
  return { ok: true };
}

/**
 * Unlink an invoice from its plan (the invoice itself is untouched). Its
 * period goes too, so that period can be invoiced by the plan again.
 */
export async function detachInvoiceFromRetainer(invoiceId: string): Promise<ActionResult> {
  await requireAdmin();
  const detached = await prisma.invoice.updateMany({
    where: { id: invoiceId },
    data: { retainerId: null, retainerPeriod: null },
  });
  if (detached.count === 0) return { ok: false, error: "Invoice not found." };
  revalidatePlans();
  return { ok: true };
}

/** Delete a plan. Its invoices stay, unlinked; nothing more is drafted. */
export async function deleteRetainer(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.$transaction([
      // The link goes with the plan (SetNull); the period has to go with it.
      prisma.invoice.updateMany({ where: { retainerId: id }, data: { retainerPeriod: null } }),
      prisma.retainer.delete({ where: { id } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false, error: "Plan not found." };
    }
    throw err;
  }
  revalidatePlans();
  return { ok: true };
}
