"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSession, requireAdmin } from "@/lib/dal/session";
import { sendPasswordLink } from "@/lib/auth-utils";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { milestoneTemplates, textToDoc } from "@/lib/milestone-templates";
import { stageWrite } from "@/lib/work-stage";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";
import { markLeadWon } from "@/lib/actions/leads";
import {
  getProposalDetail,
  getProposalDraft,
  invoiceFacts,
  proposalContact,
  proposalLinks,
  proposalSnapshotOf,
  type ProposalDetail,
  type ProposalDraft,
  type ProposalLinks,
} from "@/lib/dal/proposals";
import { getProposalDefaultTerms, listActivePaymentAccounts } from "@/lib/dal/settings";
import { formatCurrency } from "@/lib/currency";
import { usdToStore } from "@/lib/invoice-usd";
import { dueDateFromTerms, invoiceTotals } from "@/lib/invoice-totals";
import { requestMeta } from "@/lib/request-meta";
import {
  draftInvoiceRemovable,
  firstInvoicePromise,
  proposalRemovalPlan,
} from "@/lib/proposal-rules";
import { ActionAbort, removeDraftInvoice, removeSilentClient } from "@/lib/proposal-cleanup";
import { readProposalLink } from "@/lib/marketing-token";
import { emailProposal, emailSignedProposal, proposalUrl } from "@/lib/proposal-mail";
import { appUrl } from "@/lib/app-url";
import { snapshotHash, type ProposalSnapshot } from "@/lib/proposal-snapshot";
import { readSignatureDataUrl } from "@/lib/signature-png";
import {
  ADMIN_RECORD_VERSION,
  SIGNATURE_CONSENT_VERSION,
  SIGNATURE_FONT,
  adminRecordText,
  signatureConsentText,
} from "@/lib/signature-rules";
import { createRateLimiter } from "@/lib/rate-limit";
import { signedPdfFileName, storeSignedProposalPdf } from "@/lib/pdf/proposal-render";
import {
  proposalSchema,
  acceptProposalSchema,
  declineProposalSchema,
  duplicateProposalSchema,
  extendProposalSchema,
  signProposalSchema,
  type DuplicateProposalInput,
  type ProposalInput,
  type SignProposalInput,
} from "@/lib/validation/proposal";
import type {
  LeadSource,
  Prisma,
  ProjectSource,
  ProposalStatus,
  SignatureMethod,
} from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Tx = Prisma.TransactionClient;

const LINK_INVALID = "This proposal link is invalid or has expired.";
const LINK_REPLACED =
  "This link has been replaced by a newer one. Please use the link in our most recent email.";
const LINK_EXPIRED =
  "This proposal has expired. Reply to our email and we'll send you a fresh link.";
const TEAM_EMAIL =
  "This email belongs to a team account. Use the client's own email — it becomes their login.";

/** Lead source → the project's source enum (only Fiverr/Upwork map 1:1). */
function mapSource(source: LeadSource | null): ProjectSource {
  if (source === "FIVERR") return "FIVERR";
  if (source === "UPWORK") return "UPWORK";
  return "INDEPENDENT";
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sumAmounts(items: { amount: Prisma.Decimal | number }[]): number {
  return Math.round(items.reduce((acc, i) => acc + Number(i.amount), 0) * 100) / 100;
}

type Contact = { name: string; email: string; company: string | null };

/** Effective recipient (name/email/company), resolving a lead when needed. */
async function resolveContact(data: {
  source: "lead" | "manual";
  leadId?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientCompany?: string;
}): Promise<Contact | null> {
  if (data.source === "lead") {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId as string },
      select: { name: true, email: true, company: true },
    });
    if (!lead) return null;
    return { name: lead.name, email: (lead.email ?? "").toLowerCase(), company: lead.company };
  }
  return {
    name: data.recipientName ?? "",
    email: (data.recipientEmail ?? "").toLowerCase(),
    company: data.recipientCompany || null,
  };
}

/**
 * The recipient and whatever account already answers to their email. A team
 * member's address is refused: billing an admin as a client would put their
 * account behind the client portal's invoices.
 */
async function resolveRecipient(
  data: Parameters<typeof resolveContact>[0],
): Promise<
  | { contact: Contact; account: { id: string } | null }
  | { error: string }
> {
  const contact = await resolveContact(data);
  if (!contact) return { error: "Lead not found." };
  if (!contact.email) {
    return {
      error:
        data.source === "lead"
          ? "Add an email to this lead first — it becomes the client's login."
          : "An email is required — it becomes the client's login.",
    };
  }
  const user = await prisma.user.findUnique({
    where: { email: contact.email },
    select: { id: true, role: true },
  });
  if (user && user.role !== "CLIENT") return { error: TEAM_EMAIL };
  return { contact, account: user ? { id: user.id } : null };
}

/** "none"/empty → null; else the id validated against a real account. */
async function resolvePaymentAccountId(value: string | undefined): Promise<string | null> {
  if (!value || value === "none") return null;
  const account = await prisma.paymentAccount.findUnique({ where: { id: value }, select: { id: true } });
  return account?.id ?? null;
}

/** A credential password nobody knows; the invite's reset link replaces it. */
async function newPasswordHash(): Promise<string> {
  return (await auth.$context).password.hash(randomBytes(24).toString("base64url"));
}

/**
 * The client account a proposal is provisioned for: an existing CLIENT with
 * this email, or a new silent one (no invite — that goes out on acceptance).
 * `created` is what the caller stores in Proposal.createdClientAccount, which
 * later lets deleting an unsent draft take the account with it.
 */
async function findOrCreateClient(
  tx: Tx,
  contact: Contact,
  passwordHash: string | null,
): Promise<{ id: string; email: string; emailVerified: boolean; created: boolean }> {
  const existing = await tx.user.findUnique({
    where: { email: contact.email },
    select: { id: true, email: true, role: true, emailVerified: true },
  });
  if (existing) {
    if (existing.role !== "CLIENT") throw new ActionAbort(TEAM_EMAIL);
    return { id: existing.id, email: existing.email, emailVerified: existing.emailVerified, created: false };
  }
  const [firstName, ...rest] = contact.name.trim().split(/\s+/);
  const user = await tx.user.create({
    data: {
      email: contact.email,
      name: contact.name.trim() || contact.email,
      firstName: firstName || contact.email,
      lastName: rest.join(" "),
      role: "CLIENT",
      company: contact.company,
      emailVerified: false,
    },
    select: { id: true, email: true },
  });
  await tx.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash ?? (await newPasswordHash()),
    },
  });
  return { id: user.id, email: user.email, emailVerified: false, created: true };
}

function invoiceItemRows(items: { description: string; qty: number; rate: number }[]) {
  return items.map((i, index) => ({ description: i.description, qty: i.qty, rate: i.rate, sortOrder: index }));
}

/**
 * The builder posts FormData: `payload` is the JSON-encoded ProposalInput and
 * `pdf` is an optional invoice file. FormData is required because a server
 * action can't receive a File inside a plain object.
 */
function parsePayload(formData: FormData) {
  try {
    return proposalSchema.safeParse(JSON.parse(String(formData.get("payload") ?? "{}")));
  } catch {
    return { success: false, error: { issues: [{ message: "Invalid form data" }] } } as const;
  }
}

/** Saves an uploaded invoice PDF, if one was attached. */
async function handleInvoicePdf(
  formData: FormData,
): Promise<
  | { ok: true; fileName: string | null; originalName: string | null }
  | { ok: false; error: string }
> {
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, fileName: null, originalName: null };
  }
  const saved = await saveUpload("invoices", file);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, fileName: saved.fileName, originalName: file.name.slice(0, 255) };
}

function itemsFromInput(items: ProposalInput["items"]) {
  return items.map((item, index) => ({
    description: item.description,
    amount: item.amount,
    sortOrder: index,
  }));
}

/**
 * Recipient columns for a create/update. Exactly one side is populated so the
 * effective contact is unambiguous: a lead, or the manual fields.
 */
function recipientFields(data: {
  source: "lead" | "manual";
  leadId?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientCompany?: string;
}) {
  if (data.source === "lead") {
    return {
      leadId: data.leadId as string,
      recipientName: null,
      recipientEmail: null,
      recipientCompany: null,
    };
  }
  return {
    leadId: null,
    recipientName: data.recipientName || null,
    recipientEmail: data.recipientEmail?.toLowerCase() || null,
    recipientCompany: data.recipientCompany || null,
  };
}

/** Everything that lists proposals, so a change shows wherever they appear. */
function revalidateProposalViews(leadId?: string | null) {
  revalidatePath("/admin/proposals");
  revalidatePath("/admin");
  if (leadId) revalidatePath(`/admin/leads/${leadId}`);
}

/** Opens the proposal in the board's detail sheet. */
function proposalHref(id: string): string {
  return `/admin/proposals?id=${id}`;
}

// ---------- Builder ----------

/**
 * What the builder needs when it opens: the default terms, the payment
 * accounts for step 2 and, when editing, the proposal itself. Loaded on
 * demand so the board never pays for invoice lines it doesn't show.
 */
export async function loadProposalBuilder(
  id: string | null,
): Promise<
  ActionResult<{
    defaultTerms: string;
    paymentAccounts: { id: string; title: string }[];
    draft: ProposalDraft | null;
  }>
> {
  await requireAdmin();
  const [defaultTerms, accounts, draft] = await Promise.all([
    getProposalDefaultTerms(),
    listActivePaymentAccounts(),
    id ? getProposalDraft(id) : Promise.resolve(null),
  ]);
  if (id && !draft) return { ok: false, error: "Proposal not found." };
  return {
    ok: true,
    data: {
      defaultTerms,
      paymentAccounts: accounts.map((a) => ({ id: a.id, title: a.title })),
      draft,
    },
  };
}

/** The detail sheet and the delete / accept dialogs, loaded when opened. */
export async function loadProposalDetail(id: string): Promise<ActionResult<ProposalDetail>> {
  await requireAdmin();
  const detail = await getProposalDetail(id);
  if (!detail) return { ok: false, error: "Proposal not found." };
  return { ok: true, data: detail };
}

export async function createProposal(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = parsePayload(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const inv = data.invoice;
  const customNo = inv.invoiceNumber?.trim();

  // Onboarding: creating a proposal also provisions the client account and a
  // draft invoice up front, so the recipient needs an email. These checks
  // don't depend on each other, so they run as one wave.
  const [recipient, paymentAccountId, clash] = await Promise.all([
    resolveRecipient(data),
    resolvePaymentAccountId(inv.paymentAccountId),
    customNo
      ? prisma.invoice.findUnique({ where: { invoiceNumber: customNo }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if ("error" in recipient) return { ok: false, error: recipient.error };
  if (clash) return { ok: false, error: `Invoice number "${customNo}" is already used.` };
  const { contact } = recipient;

  // Stored only once everything else checks out, so a typo never strands a file.
  const pdf = await handleInvoicePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };
  const passwordHash = recipient.account ? null : await newPasswordHash();
  const totals = invoiceTotals({ items: inv.items });

  let created: { proposalId: string; clientId: string; clientCreated: boolean };
  try {
    created = await prisma.$transaction(async (tx) => {
      const client = await findOrCreateClient(tx, contact, passwordHash);
      const invoiceNumber = customNo || (await nextInvoiceNumber(tx));
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          clientId: client.id,
          amount: totals.total,
          subtotal: totals.subtotal,
          amountUsd: usdToStore(inv.currency, totals.total, null),
          // A draft until the client accepts: it isn't owed yet, so it stays
          // out of receivables and out of the client's portal. The hand-off
          // promotes it to ASSIGNED.
          status: "DRAFT",
          issueDate: parseDate(inv.issueDate) ?? new Date(),
          dueDate: parseDate(inv.dueDate),
          title: inv.title || data.title,
          currency: inv.currency,
          notes: inv.notes || null,
          billToCompany: inv.billToCompany || null,
          billToAddress: inv.billToAddress || null,
          billToEmail: inv.billToEmail || null,
          paymentAccountId,
          pdfPath: pdf.fileName,
          pdfOriginalName: pdf.originalName,
          pdfExternalUrl: data.invoicePdfExternalUrl || null,
          items: { create: invoiceItemRows(inv.items) },
        },
        select: { id: true },
      });
      const proposal = await tx.proposal.create({
        data: {
          ...recipientFields(data),
          title: data.title,
          intro: data.intro || null,
          terms: data.terms || null,
          currency: data.currency,
          projectType: data.projectType,
          timelineWeeks: data.timelineWeeks ?? null,
          depositPercent: data.depositPercent,
          expiresInDays: data.expiresInDays,
          invoicePdfPath: pdf.fileName,
          invoicePdfOriginalName: pdf.originalName,
          invoicePdfExternalUrl: data.invoicePdfExternalUrl || null,
          convertedClientId: client.id,
          convertedInvoiceId: invoice.id,
          createdClientAccount: client.created,
          items: { create: itemsFromInput(data.items) },
        },
        select: { id: true },
      });
      return { proposalId: proposal.id, clientId: client.id, clientCreated: client.created };
    });
  } catch (err) {
    if (pdf.fileName) await deleteUpload("invoices", pdf.fileName);
    if (err instanceof ActionAbort) return { ok: false, error: err.message };
    throw err;
  }

  after(() =>
    logActivity({
      type: "proposal.created",
      summary: `Proposal "${data.title}" created for ${contact.name || contact.email}`,
      actorId: admin.id,
      clientId: created.clientId,
      entity: "proposal",
      entityId: created.proposalId,
      link: proposalHref(created.proposalId),
    }),
  );

  revalidateProposalViews(data.source === "lead" ? data.leadId : null);
  revalidatePath("/admin/invoices");
  if (created.clientCreated) revalidatePath("/admin/clients");
  return { ok: true, data: { id: created.proposalId } };
}

export async function updateProposal(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ invoiceLocked: string | null }>> {
  await requireAdmin();
  const parsed = parsePayload(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const inv = data.invoice;
  const customNo = inv.invoiceNumber?.trim();

  const [existing, recipient, paymentAccountId, clash] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      select: {
        status: true,
        archivedAt: true,
        leadId: true,
        invoicePdfPath: true,
        invoicePdfOriginalName: true,
        convertedInvoiceId: true,
        convertedClientId: true,
        createdClientAccount: true,
      },
    }),
    resolveRecipient(data),
    resolvePaymentAccountId(inv.paymentAccountId),
    customNo
      ? prisma.invoice.findUnique({ where: { invoiceNumber: customNo }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (!existing) return { ok: false, error: "Proposal not found." };
  if (existing.status !== "DRAFT" || existing.archivedAt) {
    return { ok: false, error: "Only draft proposals can be edited." };
  }
  if ("error" in recipient) return { ok: false, error: recipient.error };
  if (clash && clash.id !== existing.convertedInvoiceId) {
    return { ok: false, error: `Invoice number "${customNo}" is already used.` };
  }
  const { contact } = recipient;

  // The draft was provisioned for one account; if the email now belongs to
  // someone else (or nobody), the account and the invoice have to follow it,
  // or acceptance would invite the old address and bill the wrong client.
  const recipientMoved =
    existing.convertedClientId != null && recipient.account?.id !== existing.convertedClientId;
  const passwordHash = recipientMoved && !recipient.account ? await newPasswordHash() : null;

  const pdf = await handleInvoicePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // A new upload replaces the old one; an explicit clear drops it. Otherwise
  // the existing attachment is left alone.
  const replacing = pdf.fileName !== null;
  const clearing = data.removeInvoicePdf === true;
  const nextPdfPath = replacing ? pdf.fileName : clearing ? null : existing.invoicePdfPath;
  const nextPdfName = replacing
    ? pdf.originalName
    : clearing
      ? null
      : existing.invoicePdfOriginalName;

  let outcome: { moved: boolean; invoiceLocked: string | null };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const invoice = existing.convertedInvoiceId
        ? await tx.invoice.findUnique({
            where: { id: existing.convertedInvoiceId },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              sentAt: true,
              amount: true,
              amountPaid: true,
              amountUsd: true,
              currency: true,
              discount: true,
              taxRate: true,
              _count: { select: { payments: true } },
            },
          })
        : null;

      // Still paperwork? Once the invoice has been sent from the invoice
      // page (or paid against), the builder must not rewrite it.
      const invoiceIsPaperwork =
        invoice != null &&
        draftInvoiceRemovable({
          status: invoice.status,
          sentAt: invoice.sentAt,
          amountPaid: Number(invoice.amountPaid),
          paymentCount: invoice._count.payments,
        });

      let clientId = existing.convertedClientId;
      let createdClientAccount = existing.createdClientAccount;
      if (recipientMoved) {
        // An invoice the old address has already received can't quietly
        // change hands.
        if (invoice && !invoiceIsPaperwork) {
          throw new ActionAbort(
            `Invoice ${invoice.invoiceNumber} has already gone to the old recipient, so the email can't change here. Start a new proposal for the new address instead.`,
          );
        }
        const next = await findOrCreateClient(tx, contact, passwordHash);
        clientId = next.id;
        createdClientAccount = next.created;
      }

      // Conditional on still being an unsent draft, and it holds the row: a
      // send that lands meanwhile waits for this edit, or wins and stops it.
      const claimed = await tx.proposal.updateMany({
        where: { id, status: "DRAFT", archivedAt: null },
        data: {
          ...recipientFields(data),
          title: data.title,
          intro: data.intro || null,
          terms: data.terms || null,
          currency: data.currency,
          projectType: data.projectType,
          timelineWeeks: data.timelineWeeks ?? null,
          depositPercent: data.depositPercent,
          expiresInDays: data.expiresInDays,
          invoicePdfPath: nextPdfPath,
          invoicePdfOriginalName: nextPdfName,
          invoicePdfExternalUrl: data.invoicePdfExternalUrl || null,
          convertedClientId: clientId,
          createdClientAccount,
        },
      });
      if (claimed.count === 0) {
        throw new ActionAbort("This proposal was sent or archived a moment ago, so it can no longer be edited.");
      }
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      await tx.proposalItem.createMany({
        data: itemsFromInput(data.items).map((item) => ({ ...item, proposalId: id })),
      });

      // Keep the draft invoice created alongside the proposal in sync. A
      // discount or tax set in the invoice editor survives the re-total.
      if (invoice && invoiceIsPaperwork) {
        const totals = invoiceTotals({
          items: inv.items,
          discount: Number(invoice.discount),
          taxRate: invoice.taxRate == null ? null : Number(invoice.taxRate),
        });
        // A hand-entered USD value only still holds for the same currency
        // and the same total; otherwise it waits for the payment to settle.
        const unchanged =
          invoice.currency === inv.currency && Number(invoice.amount) === totals.total;
        await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amount: totals.total,
            subtotal: totals.subtotal,
            discount: totals.discount,
            amountUsd: usdToStore(
              inv.currency,
              totals.total,
              unchanged && invoice.amountUsd != null ? Number(invoice.amountUsd) : null,
            ),
            ...(customNo ? { invoiceNumber: customNo } : {}),
            ...(clientId ? { clientId } : {}),
            issueDate: parseDate(inv.issueDate) ?? new Date(),
            dueDate: parseDate(inv.dueDate),
            title: inv.title || data.title,
            currency: inv.currency,
            notes: inv.notes || null,
            billToCompany: inv.billToCompany || null,
            billToAddress: inv.billToAddress || null,
            billToEmail: inv.billToEmail || null,
            paymentAccountId,
            ...(nextPdfPath !== existing.invoicePdfPath
              ? { pdfPath: nextPdfPath, pdfOriginalName: nextPdfName }
              : {}),
            pdfExternalUrl: data.invoicePdfExternalUrl || null,
            items: { create: invoiceItemRows(inv.items) },
          },
        });
      }

      if (recipientMoved && existing.createdClientAccount && existing.convertedClientId !== clientId) {
        await removeSilentClient(tx, existing.convertedClientId!, id);
      }
      return {
        moved: recipientMoved,
        invoiceLocked: invoice && !invoiceIsPaperwork ? invoice.invoiceNumber : null,
      };
    });
  } catch (err) {
    if (pdf.fileName) await deleteUpload("invoices", pdf.fileName);
    if (err instanceof ActionAbort) return { ok: false, error: err.message };
    throw err;
  }

  // Drop the superseded file only after the row is safely updated.
  if ((replacing || clearing) && existing.invoicePdfPath) {
    await deleteUpload("invoices", existing.invoicePdfPath);
  }

  revalidateProposalViews(existing.leadId);
  if (data.source === "lead" && data.leadId !== existing.leadId) {
    revalidatePath(`/admin/leads/${data.leadId}`);
  }
  if (existing.convertedInvoiceId) revalidatePath("/admin/invoices");
  if (outcome.moved) revalidatePath("/admin/clients");
  return { ok: true, data: { invoiceLocked: outcome.invoiceLocked } };
}

// ---------- Delete, archive, restore ----------

/**
 * "Delete" for every proposal (see proposalRemovalPlan for the rules).
 *
 * An unsent draft is deleted in one transaction, taking its draft invoice
 * along when that is still paperwork and the silent client account when this
 * proposal created it and it owns nothing else. Everything else is archived:
 * hidden from the board, its public link withdrawn, its history kept. An
 * archive may also remove a never-sent, unpaid draft invoice when the admin
 * asks; an accepted proposal's client, project and invoice always stay.
 */
export async function deleteProposal(
  id: string,
  opts: { removeInvoice?: boolean } = {},
): Promise<
  ActionResult<{ mode: "deleted" | "archived"; invoiceRemoved: boolean; clientRemoved: boolean }>
> {
  const admin = await requireAdmin();
  const [p, links] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        sentAt: true,
        archivedAt: true,
        leadId: true,
        convertedInvoiceId: true,
        convertedClientId: true,
        createdClientAccount: true,
        invoicePdfPath: true,
      },
    }),
    proposalLinks(id),
  ]);
  if (!p || !links) return { ok: false, error: "Proposal not found." };
  if (p.archivedAt) return { ok: false, error: "This proposal is already archived." };
  const plan = proposalRemovalPlan(p, invoiceFacts(links.invoice));

  if (plan.mode === "delete") {
    let result: { invoiceRemoved: boolean; clientRemoved: boolean; dropFile: boolean };
    try {
      result = await prisma.$transaction(async (tx) => {
        // Only while it is still an unsent draft: a send that landed after
        // the dialog opened makes this an archive decision instead.
        const gone = await tx.proposal.deleteMany({
          where: { id, status: "DRAFT", sentAt: null, archivedAt: null },
        });
        if (gone.count === 0) {
          throw new ActionAbort("This proposal was just sent, so it can only be archived now.");
        }
        const invoiceRemoved =
          plan.invoice === "remove" && p.convertedInvoiceId
            ? await removeDraftInvoice(tx, p.convertedInvoiceId)
            : false;
        const clientRemoved =
          p.createdClientAccount && p.convertedClientId
            ? await removeSilentClient(tx, p.convertedClientId, id)
            : false;
        // The attachment is shared with the draft invoice; it goes only once
        // no surviving invoice points at it.
        const stillUsed = p.invoicePdfPath
          ? (await tx.invoice.count({ where: { pdfPath: p.invoicePdfPath } })) > 0
          : true;
        return { invoiceRemoved, clientRemoved, dropFile: !stillUsed };
      });
    } catch (err) {
      if (err instanceof ActionAbort) return { ok: false, error: err.message };
      throw err;
    }
    if (result.dropFile && p.invoicePdfPath) await deleteUpload("invoices", p.invoicePdfPath);

    after(() =>
      logActivity({
        type: "proposal.deleted",
        summary:
          `Draft proposal "${p.title}" deleted` +
          (result.invoiceRemoved && links.invoice ? ` with invoice ${links.invoice.invoiceNumber}` : ""),
        actorId: admin.id,
        clientId: result.clientRemoved ? null : p.convertedClientId,
        entity: "proposal",
        entityId: id,
      }),
    );
    revalidateProposalViews(p.leadId);
    if (result.invoiceRemoved) revalidatePath("/admin/invoices");
    if (result.clientRemoved) revalidatePath("/admin/clients");
    return {
      ok: true,
      data: { mode: "deleted", invoiceRemoved: result.invoiceRemoved, clientRemoved: result.clientRemoved },
    };
  }

  const removeInvoice = opts.removeInvoice === true && plan.invoice === "offer" && !!p.convertedInvoiceId;
  let invoiceRemoved = false;
  try {
    invoiceRemoved = await prisma.$transaction(async (tx) => {
      const removed = removeInvoice ? await removeDraftInvoice(tx, p.convertedInvoiceId!) : false;
      // Bumping the link version withdraws every link already sent; the
      // public page recognises them and says the proposal was withdrawn. An
      // accepted proposal only leaves the board: it is the client's
      // agreement, and their link keeps showing it.
      const claimed = await tx.proposal.updateMany({
        where: { id, archivedAt: null, status: p.status },
        data: {
          archivedAt: new Date(),
          archivedById: admin.id,
          ...(p.status === "ACCEPTED" ? {} : { linkVersion: { increment: 1 } }),
          ...(removed ? { convertedInvoiceId: null } : {}),
        },
      });
      if (claimed.count === 0) {
        throw new ActionAbort("This proposal changed a moment ago. Refresh and try again.");
      }
      await tx.proposalEvent.create({
        data: {
          proposalId: id,
          type: "ARCHIVED",
          actorId: admin.id,
          ...(removed && links.invoice ? { meta: { removedInvoice: links.invoice.invoiceNumber } } : {}),
        },
      });
      return removed;
    });
  } catch (err) {
    if (err instanceof ActionAbort) return { ok: false, error: err.message };
    throw err;
  }

  after(() =>
    logActivity({
      type: "proposal.archived",
      summary:
        `Proposal "${p.title}" archived` +
        (invoiceRemoved && links.invoice ? ` and draft invoice ${links.invoice.invoiceNumber} removed` : ""),
      actorId: admin.id,
      clientId: p.convertedClientId,
      entity: "proposal",
      entityId: id,
      link: proposalHref(id),
    }),
  );
  revalidateProposalViews(p.leadId);
  if (invoiceRemoved) revalidatePath("/admin/invoices");
  return { ok: true, data: { mode: "archived", invoiceRemoved, clientRemoved: false } };
}

/** Brings an archived proposal back to its lane. Its old links stay withdrawn. */
export async function restoreProposal(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const restored = await prisma.proposal.updateMany({
    where: { id, archivedAt: { not: null } },
    data: { archivedAt: null, archivedById: null },
  });
  if (restored.count === 0) return { ok: false, error: "This proposal isn't archived." };
  const [p] = await Promise.all([
    prisma.proposal.findUnique({ where: { id }, select: { leadId: true } }),
    prisma.proposalEvent.create({ data: { proposalId: id, type: "RESTORED", actorId: admin.id } }),
  ]);
  revalidateProposalViews(p?.leadId);
  return { ok: true };
}

// ---------- Sending ----------

const SEND_SELECT = {
  id: true,
  title: true,
  intro: true,
  status: true,
  currency: true,
  timelineWeeks: true,
  expiresInDays: true,
  linkVersion: true,
  archivedAt: true,
  leadId: true,
  recipientName: true,
  recipientEmail: true,
  recipientCompany: true,
  items: { select: { amount: true } },
  lead: { select: { name: true, email: true, company: true, stage: true } },
} satisfies Prisma.ProposalSelect;

type SendRow = Prisma.ProposalGetPayload<{ select: typeof SEND_SELECT }>;

/**
 * The shared tail of send, resend and extend: claim the row as it was seen
 * (so a double click can't email twice), stamp the new window, and email the
 * link for the new version once the response is on its way.
 */
async function shareProposal(
  p: SendRow,
  links: ProposalLinks | null,
  opts: { days: number; variant: "sent" | "resent" | "extended"; actorId: string },
): Promise<ActionResult> {
  const contact = proposalContact(p);
  if (!contact.email) {
    return {
      ok: false,
      error: p.leadId
        ? "Add an email to this lead first — the proposal is sent to it."
        : "Add a recipient email first — the proposal is sent to it.",
    };
  }
  // The lead's email can change on the leads page after the draft was
  // provisioned. Sending to the new address while the account (and so the
  // invite on acceptance) keeps the old one would split the client in two.
  if (links?.client && links.client.email.toLowerCase() !== contact.email.toLowerCase()) {
    return {
      ok: false,
      error:
        p.status === "DRAFT"
          ? `The recipient's email is now ${contact.email}, but this draft was set up for ${links.client.email}. Open it and save to move it to the new address, then send.`
          : `The recipient's email is now ${contact.email}, but this proposal was set up for ${links.client.email}. Duplicate it for the new address instead.`,
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);
  // The first send keeps the version the draft was born with; every later
  // one moves it on, which retires the links sent before.
  const linkVersion = opts.variant === "sent" ? p.linkVersion : p.linkVersion + 1;

  const claimed = await prisma.proposal.updateMany({
    where: { id: p.id, status: p.status, linkVersion: p.linkVersion, archivedAt: null },
    data: {
      status: "SENT",
      sentAt: now,
      expiresAt,
      expiresInDays: opts.days,
      linkVersion,
      // A resend after a "no" is a fresh offer.
      declinedAt: null,
      declineReason: null,
    },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "This proposal changed a moment ago. Refresh and try again." };
  }

  await Promise.all([
    prisma.proposalEvent.create({
      data: {
        proposalId: p.id,
        type: opts.variant === "sent" ? "SENT" : opts.variant === "resent" ? "RESENT" : "EXTENDED",
        actorId: opts.actorId,
        meta: { expiresAt: expiresAt.toISOString(), days: opts.days, linkVersion },
      },
    }),
    // Nudge a pipeline lead into the Proposal-sent column (never downgrade Won/Lost).
    p.leadId
      ? prisma.lead.updateMany({
          where: { id: p.leadId, stage: { in: ["NEW", "CONTACTED"] } },
          data: { stage: "PROPOSAL" },
        })
      : Promise.resolve(null),
  ]);

  const url = proposalUrl({ id: p.id, expiresAt, linkVersion });
  after(() =>
    emailProposal({
      to: contact.email!,
      recipientName: contact.name,
      title: p.title,
      intro: p.intro,
      total: sumAmounts(p.items),
      currency: p.currency,
      timelineWeeks: p.timelineWeeks,
      expiresAt,
      url,
      variant: opts.variant,
    }),
  );

  revalidateProposalViews(p.leadId);
  if (p.leadId) revalidatePath("/admin/leads");
  return { ok: true };
}

/**
 * Sends a draft, or resends a sent or declined proposal. A resend mints a new
 * link and withdraws the old one.
 */
export async function sendProposal(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const [p, links] = await Promise.all([
    prisma.proposal.findUnique({ where: { id }, select: SEND_SELECT }),
    proposalLinks(id),
  ]);
  if (!p) return { ok: false, error: "Proposal not found." };
  if (p.archivedAt) return { ok: false, error: "Restore this proposal before sending it." };
  if (p.status === "ACCEPTED") return { ok: false, error: "This proposal was already accepted." };
  if (p.status === "EXPIRED") return { ok: false, error: "This proposal expired — extend it instead." };
  return shareProposal(p, links, {
    days: p.expiresInDays,
    variant: p.status === "DRAFT" ? "sent" : "resent",
    actorId: admin.id,
  });
}

/**
 * More time for a sent or expired proposal: a new expiry, a new link (the old
 * one is withdrawn) and an email that says so.
 */
export async function extendProposal(id: string, days: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = extendProposalSchema.safeParse({ days });
  if (!parsed.success) return { ok: false, error: "Pick how many days to extend by." };
  const [p, links] = await Promise.all([
    prisma.proposal.findUnique({ where: { id }, select: SEND_SELECT }),
    proposalLinks(id),
  ]);
  if (!p) return { ok: false, error: "Proposal not found." };
  if (p.archivedAt) return { ok: false, error: "Restore this proposal before extending it." };
  if (p.status !== "SENT" && p.status !== "EXPIRED") {
    return { ok: false, error: "Only a sent or expired proposal can be extended." };
  }
  return shareProposal(p, links, { days: parsed.data.days, variant: "extended", actorId: admin.id });
}

/** Re-derives the public link for "Copy link": the current version, never an old one. */
export async function getProposalLink(id: string): Promise<ActionResult<{ url: string }>> {
  await requireAdmin();
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { expiresAt: true, status: true, linkVersion: true, archivedAt: true },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.archivedAt && proposal.status !== "ACCEPTED") {
    return { ok: false, error: "This proposal is archived — its link is withdrawn." };
  }
  if (!proposal.expiresAt || proposal.status === "DRAFT") {
    return { ok: false, error: "Send the proposal first to create its link." };
  }
  return {
    ok: true,
    data: { url: proposalUrl({ id, expiresAt: proposal.expiresAt, linkVersion: proposal.linkVersion }) },
  };
}

/** Pauses or resumes the automatic reminder emails for one proposal. */
export async function setProposalReminders(id: string, enabled: boolean): Promise<ActionResult> {
  await requireAdmin();
  const updated = await prisma.proposal.updateMany({
    where: { id },
    data: { remindersEnabled: enabled },
  });
  if (updated.count === 0) return { ok: false, error: "Proposal not found." };
  revalidatePath("/admin/proposals");
  return { ok: true };
}

// ---------- Duplicate ----------

/**
 * A new draft from an existing proposal: the same title (+ " (copy)"), intro,
 * terms, currency, scope, deposit, timeline and validity window, optionally
 * for someone else. It gets its own draft invoice, copied from the source's
 * lines under a new number, and its own provisioning, exactly as if it had
 * been built by hand. Status, signatures, sent/viewed stamps and the source's
 * client, project and invoice are never carried over.
 */
export async function duplicateProposal(
  id: string,
  input: DuplicateProposalInput,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsedRecipient = duplicateProposalSchema.safeParse(input);
  if (!parsedRecipient.success) {
    return { ok: false, error: parsedRecipient.error.issues[0]?.message ?? "Invalid recipient" };
  }
  const choice = parsedRecipient.data;

  const source = await prisma.proposal.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) return { ok: false, error: "Proposal not found." };

  const target =
    choice.source === "same"
      ? source.leadId
        ? { source: "lead" as const, leadId: source.leadId }
        : {
            source: "manual" as const,
            recipientName: source.recipientName ?? "",
            recipientEmail: source.recipientEmail ?? "",
            recipientCompany: source.recipientCompany ?? "",
          }
      : choice;

  const [recipient, sourceInvoice] = await Promise.all([
    resolveRecipient(target),
    source.convertedInvoiceId
      ? prisma.invoice.findUnique({
          where: { id: source.convertedInvoiceId },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        })
      : Promise.resolve(null),
  ]);
  if ("error" in recipient) return { ok: false, error: recipient.error };
  const passwordHash = recipient.account ? null : await newPasswordHash();
  const sameRecipient = choice.source === "same";

  // The source's own invoice lines when it has them; an older proposal
  // without one starts from its scope, as the builder would.
  const lines = sourceInvoice?.items.length
    ? sourceInvoice.items.map((i, index) => ({
        description: i.description,
        // Left out rather than written as null: a new row's column is null anyway.
        ...(i.descriptionRich != null
          ? { descriptionRich: i.descriptionRich as Prisma.InputJsonValue }
          : {}),
        qty: Number(i.qty),
        rate: Number(i.rate),
        sortOrder: index,
      }))
    : source.items.map((i, index) => ({
        description: i.description,
        qty: 1,
        rate: Number(i.amount),
        sortOrder: index,
      }));
  const totals = invoiceTotals({
    items: lines,
    discount: sourceInvoice ? Number(sourceInvoice.discount) : 0,
    taxRate: sourceInvoice?.taxRate == null ? null : Number(sourceInvoice.taxRate),
  });
  const currency = sourceInvoice?.currency ?? source.currency;
  const title = `${source.title} (copy)`.slice(0, 160);
  const issueDate = new Date();

  let created: { id: string; clientCreated: boolean };
  try {
    created = await prisma.$transaction(async (tx) => {
      const client = await findOrCreateClient(tx, recipient.contact, passwordHash);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: await nextInvoiceNumber(tx),
          clientId: client.id,
          status: "DRAFT",
          amount: totals.total,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxRate: sourceInvoice?.taxRate ?? null,
          taxLabel: sourceInvoice?.taxLabel ?? null,
          paymentTermsDays: sourceInvoice?.paymentTermsDays ?? null,
          amountUsd: usdToStore(currency, totals.total, null),
          currency,
          issueDate,
          // Net terms carry over as terms, not as the source's old due date.
          dueDate: parseDate(
            dueDateFromTerms(issueDate.toISOString().slice(0, 10), sourceInvoice?.paymentTermsDays),
          ),
          // Client-facing, so no "(copy)" on it.
          title: sourceInvoice?.title ?? null,
          notes: sourceInvoice?.notes ?? null,
          // The billed-to overrides describe the old client.
          billToCompany: sameRecipient ? (sourceInvoice?.billToCompany ?? null) : null,
          billToAddress: sameRecipient ? (sourceInvoice?.billToAddress ?? null) : null,
          billToEmail: sameRecipient ? (sourceInvoice?.billToEmail ?? null) : null,
          paymentAccountId: sourceInvoice?.paymentAccountId ?? null,
          duplicatedFromId: sourceInvoice?.id ?? null,
          items: { create: lines },
        },
        select: { id: true },
      });
      const proposal = await tx.proposal.create({
        data: {
          ...recipientFields(target),
          title,
          intro: source.intro,
          terms: source.terms,
          currency: source.currency,
          projectType: source.projectType,
          timelineWeeks: source.timelineWeeks,
          depositPercent: source.depositPercent,
          expiresInDays: source.expiresInDays,
          remindersEnabled: source.remindersEnabled,
          convertedClientId: client.id,
          convertedInvoiceId: invoice.id,
          createdClientAccount: client.created,
          items: {
            create: source.items.map((i, index) => ({
              description: i.description,
              amount: i.amount,
              sortOrder: index,
            })),
          },
        },
        select: { id: true },
      });
      return { id: proposal.id, clientCreated: client.created };
    });
  } catch (err) {
    if (err instanceof ActionAbort) return { ok: false, error: err.message };
    throw err;
  }

  after(() =>
    logActivity({
      type: "proposal.created",
      summary: `Proposal "${title}" duplicated from "${source.title}" for ${recipient.contact.name || recipient.contact.email}`,
      actorId: admin.id,
      entity: "proposal",
      entityId: created.id,
      link: proposalHref(created.id),
    }),
  );
  revalidateProposalViews(target.source === "lead" ? target.leadId : null);
  revalidatePath("/admin/invoices");
  if (created.clientCreated) revalidatePath("/admin/clients");
  return { ok: true, data: { id: created.id } };
}

// ---------- Acceptance ----------

const HANDOFF_INCLUDE = {
  items: { orderBy: { sortOrder: "asc" } },
  lead: { select: { id: true, name: true, email: true, company: true, source: true } },
} satisfies Prisma.ProposalInclude;

/** The proposal as the hand-off read it, just before claiming it. */
type HandoffProposal = Prisma.ProposalGetPayload<{ include: typeof HANDOFF_INCLUDE }>;

type Loaded = { proposal: HandoffProposal; links: ProposalLinks };

/**
 * What a hand-off works from, in one wave: the proposal with its scope and
 * lead, and the references it keeps without foreign keys (proposalLinks). The
 * sign action reads it once and builds its snapshot from the same rows the
 * hand-off then uses, so nothing is read twice.
 */
async function loadHandoff(id: string): Promise<Loaded | null> {
  const [proposal, links] = await Promise.all([
    prisma.proposal.findUnique({ where: { id }, include: HANDOFF_INCLUDE }),
    proposalLinks(id),
  ]);
  return proposal && links ? { proposal, links } : null;
}

/**
 * The evidence row every acceptance writes (ProposalSignature): who signed
 * and how, the consent or statement they were given, and the snapshot of
 * exactly what was agreed with its hash. Written in the hand-off's own
 * transaction, so a signature can never exist without its hand-off, or the
 * other way round.
 */
type SignatureEvidence = {
  method: SignatureMethod;
  signerName: string;
  signerEmail: string;
  signerTitle: string | null;
  signerCompany: string | null;
  imagePng: Buffer | null;
  typedFont: string | null;
  consentText: string;
  consentVersion: string;
  snapshot: ProposalSnapshot;
  documentHash: string;
  tokenFingerprint: string | null;
  recordedById: string | null;
};

type Acceptance = {
  signedName: string;
  /** The admin recorded an agreement made elsewhere (call, chat, email). */
  byAdmin: boolean;
  actorId?: string | null;
  /** The link version the client signed through; it must still be current. */
  linkVersion?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  signature: SignatureEvidence;
  /** Extra detail for the SIGNED audit event (the raw forwarding chain, the signer's zone, evidence). */
  eventMeta?: Record<string, string | number | boolean | null>;
  /** The signer's own copy: where the signed PDF is emailed, and the link it opens at. */
  signedCopy?: { email: string; viewUrl: string };
};

type HandoffData = {
  accepted: true;
  /** Somebody (a double click, another tab) got there first; nothing was created twice. */
  alreadyAccepted: boolean;
  /** A set-your-password invite is on its way (the client had no login yet). */
  portalInvite: boolean;
};

type HandoffResult = ActionResult<HandoffData>;

const ALREADY_ACCEPTED: HandoffResult = {
  ok: true,
  data: { accepted: true, alreadyAccepted: true, portalInvite: false },
};

/** Why this acceptance can't go ahead, in words for whoever is accepting. */
function handoffBlocker(
  p: { status: ProposalStatus; archivedAt: Date | null; linkVersion: number; expiresAt: Date | null },
  acceptance: { byAdmin: boolean; linkVersion?: number },
  now: Date,
): string | null {
  if (p.archivedAt) return "This proposal was withdrawn.";
  if (acceptance.byAdmin) {
    return p.status === "DECLINED"
      ? "This proposal was declined. Resend it before marking it accepted."
      : null;
  }
  if (p.status !== "SENT") return "This proposal is no longer open.";
  if (acceptance.linkVersion !== p.linkVersion) return LINK_REPLACED;
  if (!p.expiresAt || p.expiresAt <= now) return LINK_EXPIRED;
  return null;
}

/**
 * The new project's plan. One milestone per scope line, in the proposal's
 * order, so the board starts with what was sold; unpriced, because a CONTRACT
 * project is billed as a whole and its milestone prices are ignored. Only a
 * proposal with no scope lines (very old ones) falls back to the project
 * type's template.
 */
function handoffMilestones(proposal: HandoffProposal, now: Date) {
  const scope = proposal.items
    .map((item) => item.description.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const plan =
    scope.length > 0
      ? scope.map((title) => ({ title, description: undefined }))
      : milestoneTemplates[proposal.projectType].map((m) => ({
          title: m.title,
          description: textToDoc(m.description),
        }));
  return plan.map((m, index) => ({
    title: m.title,
    ...(m.description ? { description: m.description } : {}),
    pricingType: "NONE" as const,
    position: index,
    boardPosition: (index + 1) * 1024,
    ...stageWrite("TODO", null, now),
  }));
}

/**
 * The one hand-off, behind the client's signature AND the admin's "mark
 * accepted". It records the signature evidence, creates a CONTRACT project
 * priced at the proposal total with the scope as its milestones, attaches the
 * first invoice (or creates the deposit invoice the client was promised),
 * marks a backing lead WON and records who accepted.
 *
 * The FIRST statement of its transaction claims the proposal: a conditional
 * update to ACCEPTED that only one caller can win. Two tabs, a double click,
 * or the client signing while the admin clicks "mark accepted" all reach it;
 * the losers find the row already ACCEPTED and get the same success back
 * without creating a second project or a second signature. The admin's claim
 * also requires the row to be unchanged since it was read, because the
 * snapshot it records was built from that read (a client's claim is held to
 * its link version instead: content only changes on a draft, and every resend
 * or extension moves the version).
 *
 * The signed PDF, the emails, the notification and the activity log run after
 * the response. Callers must have already authorised the action (link or
 * admin session).
 */
async function runHandoff({ proposal, links }: Loaded, acceptance: Acceptance): Promise<HandoffResult> {
  const id = proposal.id;
  const now = new Date();
  if (proposal.status === "ACCEPTED") return ALREADY_ACCEPTED;
  const blocker = handoffBlocker(proposal, acceptance, now);
  if (blocker) return { ok: false, error: blocker };

  const total = sumAmounts(proposal.items);
  const contact = proposalContact(proposal);

  // Proposals made before provisioning moved to creation time have no
  // account yet; it is found or created inside the transaction.
  let newAccount: { contact: Contact; passwordHash: string | null } | null = null;
  if (!links.client) {
    if (!contact.email) return { ok: false, error: "No contact email on file for this proposal." };
    const recipient = await resolveRecipient({
      source: "manual",
      recipientName: contact.name,
      recipientEmail: contact.email,
      recipientCompany: contact.company ?? "",
    });
    if ("error" in recipient) return { ok: false, error: recipient.error };
    newAccount = {
      contact: recipient.contact,
      passwordHash: recipient.account ? null : await newPasswordHash(),
    };
  }

  // The same decision the public page made when it told the client what
  // they would be invoiced first (see firstInvoicePromise), and that the
  // snapshot records.
  const promise = firstInvoicePromise(
    { total, currency: proposal.currency, depositPercent: proposal.depositPercent },
    links.invoice,
  );
  const attach = promise?.kind === "invoice" ? links.invoice : null;
  const deposit = promise?.kind === "deposit" ? promise : null;

  const claimWhere: Prisma.ProposalWhereInput = acceptance.byAdmin
    ? {
        id,
        archivedAt: null,
        status: { in: ["DRAFT", "SENT", "EXPIRED"] },
        updatedAt: proposal.updatedAt,
      }
    : {
        id,
        archivedAt: null,
        status: "SENT",
        linkVersion: acceptance.linkVersion,
        expiresAt: { gt: now },
      };
  const evidence = acceptance.signature;

  type Outcome =
    | {
        claimed: false;
        current: { status: ProposalStatus; archivedAt: Date | null; linkVersion: number; expiresAt: Date | null } | null;
      }
    | {
        claimed: true;
        client: { id: string; email: string; emailVerified: boolean };
        projectId: string;
        invoiceNumber: string | null;
        signatureId: string;
      };

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      const claimed = await tx.proposal.updateMany({
        where: claimWhere,
        data: {
          status: "ACCEPTED",
          acceptedAt: now,
          acceptedName: acceptance.signedName,
          acceptedByAdmin: acceptance.byAdmin,
          documentHash: evidence.documentHash,
        },
      });
      if (claimed.count === 0) {
        const current = await tx.proposal.findUnique({
          where: { id },
          select: { status: true, archivedAt: true, linkVersion: true, expiresAt: true },
        });
        return { claimed: false, current };
      }

      const client = links.client
        ? { ...links.client, created: false }
        : await findOrCreateClient(tx, newAccount!.contact, newAccount!.passwordHash);

      const signature = await tx.proposalSignature.create({
        data: {
          proposalId: id,
          clientId: client.id,
          role: "CLIENT",
          method: evidence.method,
          signerName: evidence.signerName,
          signerEmail: evidence.signerEmail,
          signerTitle: evidence.signerTitle,
          signerCompany: evidence.signerCompany,
          imagePng: evidence.imagePng ? new Uint8Array(evidence.imagePng) : null,
          typedFont: evidence.typedFont,
          consentText: evidence.consentText,
          consentVersion: evidence.consentVersion,
          documentHash: evidence.documentHash,
          snapshot: evidence.snapshot as unknown as Prisma.InputJsonObject,
          snapshotVersion: evidence.snapshot.snapshotVersion,
          ipAddress: acceptance.ipAddress ?? null,
          userAgent: acceptance.userAgent ?? null,
          tokenFingerprint: evidence.tokenFingerprint,
          recordedById: evidence.recordedById,
          signedAt: now,
        },
        select: { id: true },
      });

      const project = await tx.project.create({
        data: {
          projectName: proposal.title,
          clientId: client.id,
          type: proposal.projectType,
          source: mapSource(proposal.lead?.source ?? null),
          priority: "MEDIUM",
          status: "PLANNING",
          billingType: "CONTRACT",
          contractPrice: total,
          milestones: { create: handoffMilestones(proposal, now) },
        },
        select: { id: true },
      });

      let invoiceId: string | null = attach?.id ?? null;
      let invoiceNumber: string | null = attach?.invoiceNumber ?? null;
      if (attach) {
        await tx.invoice.updateMany({ where: { id: attach.id }, data: { projectId: project.id } });
        // Agreed now, so owed now: the draft becomes a normal invoice the
        // client sees and the admin can send.
        if (attach.status === "DRAFT") {
          await tx.invoice.updateMany({
            where: { id: attach.id, status: "DRAFT" },
            data: { status: "ASSIGNED" },
          });
        }
      } else if (deposit) {
        const label = `${proposal.title} — ${deposit.percent}% deposit`;
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await nextInvoiceNumber(tx),
            clientId: client.id,
            projectId: project.id,
            amount: deposit.amount,
            subtotal: deposit.amount,
            currency: proposal.currency,
            amountUsd: usdToStore(proposal.currency, deposit.amount, null),
            status: "ASSIGNED",
            issueDate: now,
            title: label,
            notes: `${deposit.percent}% deposit for "${proposal.title}"`,
            // Carry the invoice document attached in the builder, so the
            // client gets the paperwork with the deposit invoice.
            pdfPath: proposal.invoicePdfPath,
            pdfOriginalName: proposal.invoicePdfOriginalName,
            pdfExternalUrl: proposal.invoicePdfExternalUrl,
            // A line item so the generated PDF is complete without editing.
            items: { create: [{ description: label, qty: 1, rate: deposit.amount, sortOrder: 0 }] },
          },
          select: { id: true, invoiceNumber: true },
        });
        invoiceId = invoice.id;
        invoiceNumber = invoice.invoiceNumber;
      }

      if (proposal.lead) await markLeadWon(tx, proposal.lead.id, client.id);
      await tx.proposal.update({
        where: { id },
        data: {
          convertedClientId: client.id,
          convertedProjectId: project.id,
          convertedInvoiceId: invoiceId,
          ...(client.created ? { createdClientAccount: true } : {}),
        },
      });
      await tx.proposalEvent.create({
        data: {
          proposalId: id,
          type: "SIGNED",
          actorId: acceptance.actorId ?? null,
          ipAddress: acceptance.ipAddress ?? null,
          userAgent: acceptance.userAgent ?? null,
          // The same instant as acceptedAt and signedAt, not the database's
          // transaction start, so the audit trail agrees with itself.
          createdAt: now,
          meta: {
            ...acceptance.eventMeta,
            name: acceptance.signedName,
            method: evidence.method,
            signatureId: signature.id,
            documentHash: evidence.documentHash,
          },
        },
      });
      return {
        claimed: true,
        client: { id: client.id, email: client.email, emailVerified: client.emailVerified },
        projectId: project.id,
        invoiceNumber,
        signatureId: signature.id,
      };
    });
  } catch (err) {
    if (err instanceof ActionAbort) return { ok: false, error: err.message };
    throw err;
  }

  if (!outcome.claimed) {
    const current = outcome.current;
    if (current?.status === "ACCEPTED") return ALREADY_ACCEPTED;
    const why = current ? handoffBlocker(current, acceptance, now) : null;
    return {
      ok: false,
      error: why ?? "This proposal changed a moment ago. Refresh and try again.",
    };
  }

  const { client, projectId, invoiceNumber, signatureId } = outcome;
  // A client who already has a login gets their project in the portal, not a
  // password-reset email they never asked for.
  const portalInvite = !client.emailVerified;
  const who = acceptance.byAdmin ? contact.name : acceptance.signedName;
  after(async () => {
    if (portalInvite) {
      try {
        await sendPasswordLink(client.email);
      } catch (err) {
        console.error("[proposals] invite after acceptance failed:", (err as Error).message);
      }
    }

    // Rendered once, from the snapshot just committed, and kept: the copy
    // the signer and the owner are sent is the stored one.
    let pdf: { filename: string; content: Buffer } | null = null;
    try {
      const rendered = await storeSignedProposalPdf(signatureId);
      if (rendered) pdf = { filename: signedPdfFileName(rendered.title), content: rendered.pdf };
    } catch (err) {
      console.error("[proposals] signed PDF failed:", (err as Error).message);
    }

    if (acceptance.signedCopy) {
      try {
        await emailSignedProposal({
          to: acceptance.signedCopy.email,
          signerName: acceptance.signedName,
          title: proposal.title,
          signedAt: now,
          documentHash: evidence.documentHash,
          viewUrl: acceptance.signedCopy.viewUrl,
          pdf,
          portalInvite,
        });
      } catch (err) {
        console.error("[proposals] signed copy email failed:", (err as Error).message);
      }
    }

    if (!acceptance.byAdmin) {
      try {
        await notifyAllAdmins({
          type: "PROPOSAL_ACCEPTED",
          title: `${who} signed "${proposal.title}"`,
          body:
            `${formatCurrency(total, proposal.currency)} · project created` +
            (invoiceNumber ? `, invoice ${invoiceNumber} ready to send` : "") +
            (pdf ? ". The signed PDF is attached." : ""),
          link: proposalHref(id),
          attachments: pdf ? [pdf] : undefined,
        });
      } catch (err) {
        console.error("[proposals] acceptance notification failed:", (err as Error).message);
      }
    }
    // On the project's timeline too, which the team can read — so no money.
    await logActivity({
      type: "proposal.accepted",
      summary: acceptance.byAdmin
        ? `"${proposal.title}" marked accepted on behalf of ${acceptance.signedName}`
        : `${who} signed "${proposal.title}"`,
      actorId: acceptance.actorId ?? null,
      clientId: client.id,
      projectId,
      entity: "proposal",
      entityId: id,
      link: proposalHref(id),
    });
  });

  revalidateProposalViews(proposal.leadId);
  revalidatePath("/admin/leads");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/projects");
  revalidatePath("/admin/invoices");
  return { ok: true, data: { accepted: true, alreadyAccepted: false, portalInvite } };
}

/**
 * Signing tries per address before the action stops listening for a while.
 * A real signer needs one or two; this only slows a script down.
 */
const signAttempts = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

const STALE_DOCUMENT = "This proposal was updated, please review the latest version.";

export type SignProposalResult =
  | { ok: true; data?: HandoffData }
  | { ok: false; error: string; reload?: true };

/** A zone the server's Intl knows, or nothing: it is printed on the certificate. */
function validTimeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * PUBLIC action (no session): the prospect signs the proposal, which accepts
 * it. Nothing the browser sends is taken on trust:
 *
 * - the link's signature is checked first, before any database read, and its
 *   version and expiry again in the hand-off's claim;
 * - every field is capped (signProposalSchema) and attempts are rate-limited
 *   per address;
 * - a drawn signature must be a real, non-empty PNG of sane size
 *   (signature-png.ts), a typed one has no image at all;
 * - the document is rebuilt from the database, never from the client, and
 *   its hash must equal the one the page rendered, or the client is asked to
 *   review the latest version instead of signing something they haven't seen.
 *
 * The signature, its snapshot and hash, the SIGNED event and the whole
 * hand-off commit in one transaction. Idempotent once accepted.
 */
export async function signProposal(
  id: string,
  token: string,
  input: SignProposalInput,
): Promise<SignProposalResult> {
  if (typeof id !== "string" || typeof token !== "string" || id.length > 64 || token.length > 256) {
    return { ok: false, error: LINK_INVALID };
  }
  const claims = readProposalLink(id, token);
  if (!claims) return { ok: false, error: LINK_INVALID };

  const meta = await requestMeta();
  const allowed = signAttempts.take(meta.ipAddress ?? `proposal:${id}`);
  if (!allowed.ok) {
    return {
      ok: false,
      error: `Too many attempts. Please wait ${Math.ceil(allowed.retryAfterMs / 60_000)} minutes and try again.`,
    };
  }

  const parsed = signProposalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const data = parsed.data;
  if (data.consentVersion !== SIGNATURE_CONSENT_VERSION) {
    return {
      ok: false,
      error: "The signing wording has changed since this page loaded. Reload the proposal to see it.",
      reload: true,
    };
  }
  let image: Buffer | null = null;
  if (data.method === "DRAWN") {
    const checked = readSignatureDataUrl(data.imagePng);
    if (!checked.ok) return { ok: false, error: checked.error };
    image = checked.image.bytes;
  }

  const loaded = await loadHandoff(id);
  if (!loaded) return { ok: false, error: LINK_INVALID };
  if (loaded.proposal.status === "ACCEPTED") return ALREADY_ACCEPTED;
  const blocker = handoffBlocker(loaded.proposal, { byAdmin: false, linkVersion: claims.version }, new Date());
  if (blocker) return { ok: false, error: blocker };

  // What the server knows the client is signing; the page's hash must match.
  const snapshot = proposalSnapshotOf(loaded.proposal, loaded.links.invoice);
  const documentHash = snapshotHash(snapshot);
  if (documentHash !== data.documentHash) return { ok: false, error: STALE_DOCUMENT, reload: true };

  const company = data.signerCompany || null;
  return runHandoff(loaded, {
    signedName: data.signerName,
    byAdmin: false,
    linkVersion: claims.version,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    signature: {
      method: data.method,
      signerName: data.signerName,
      signerEmail: data.signerEmail,
      signerTitle: data.signerTitle || null,
      signerCompany: company,
      imagePng: image,
      typedFont: data.method === "TYPED" ? SIGNATURE_FONT : null,
      consentText: signatureConsentText(company),
      consentVersion: SIGNATURE_CONSENT_VERSION,
      snapshot,
      documentHash,
      // Ties the signature to the link it came through without keeping a
      // usable credential.
      tokenFingerprint: createHash("sha256").update(token).digest("hex"),
      recordedById: null,
    },
    eventMeta: {
      forwardedFor: meta.forwardedFor,
      realIp: meta.realIp,
      timeZone: validTimeZone(data.timeZone),
      linkVersion: claims.version,
    },
    signedCopy: {
      email: data.signerEmail,
      viewUrl: `${appUrl()}/proposals/${id}?token=${encodeURIComponent(token)}`,
    },
  });
}

/**
 * Admin closes the proposal on the client's behalf (they agreed by call,
 * chat or email). Runs the same hand-off and records a signature too, marked
 * ADMIN_RECORDED, with the same snapshot and hash, the admin who recorded it,
 * their address and browser, and optionally the proof (an email saved as PDF,
 * a screenshot). The certificate then says plainly that Avix Digital recorded
 * it on the client's behalf.
 *
 * FormData: `signedName` (who agreed) and an optional `evidence` file.
 */
export async function markProposalAccepted(id: string, formData: FormData): Promise<HandoffResult> {
  const admin = await requireAdmin();
  const parsed = acceptProposalSchema.safeParse({ signedName: formData.get("signedName") ?? "" });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter who agreed" };
  }
  const name = parsed.data.signedName;
  const file = formData.get("evidence");
  const proof = file instanceof File && file.size > 0 ? file : null;

  const [loaded, meta] = await Promise.all([loadHandoff(id), requestMeta()]);
  if (!loaded) return { ok: false, error: "Proposal not found." };
  if (loaded.proposal.status === "ACCEPTED") return ALREADY_ACCEPTED;
  const blocker = handoffBlocker(loaded.proposal, { byAdmin: true }, new Date());
  if (blocker) return { ok: false, error: blocker };

  // Stored only once the proposal can be accepted, and removed again below
  // if the hand-off doesn't happen after all.
  let evidence: { fileName: string; originalName: string } | null = null;
  if (proof) {
    const saved = await saveUpload("contracts", proof);
    if (!saved.ok) return { ok: false, error: saved.error };
    evidence = { fileName: saved.fileName, originalName: proof.name.slice(0, 255) };
  }

  const snapshot = proposalSnapshotOf(loaded.proposal, loaded.links.invoice);
  const contact = proposalContact(loaded.proposal);
  let result: HandoffResult;
  try {
    result = await runHandoff(loaded, {
      signedName: name,
      byAdmin: true,
      actorId: admin.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      signature: {
        method: "ADMIN_RECORDED",
        signerName: name,
        signerEmail: loaded.links.client?.email ?? contact.email ?? "",
        signerTitle: null,
        signerCompany: contact.company,
        imagePng: null,
        typedFont: null,
        consentText: adminRecordText(name),
        consentVersion: ADMIN_RECORD_VERSION,
        snapshot,
        documentHash: snapshotHash(snapshot),
        tokenFingerprint: null,
        recordedById: admin.id,
      },
      eventMeta: {
        forwardedFor: meta.forwardedFor,
        realIp: meta.realIp,
        ...(evidence ? { evidenceFile: evidence.fileName, evidenceName: evidence.originalName } : {}),
      },
    });
  } catch (err) {
    if (evidence) await deleteUpload("contracts", evidence.fileName);
    throw err;
  }
  if (evidence && (!result.ok || result.data?.alreadyAccepted)) {
    await deleteUpload("contracts", evidence.fileName);
  }
  return result;
}

// ---------- The client's side: decline and views ----------

/**
 * PUBLIC action: the prospect says no, optionally saying why. The lead's
 * stage is left alone — whether a "no" means lost is the admin's call, made
 * from the board.
 */
export async function declineProposal(
  id: string,
  token: string,
  reason?: string,
): Promise<ActionResult> {
  const parsed = declineProposalSchema.safeParse({ reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid reason" };
  }
  const claims = readProposalLink(id, token);
  if (!claims) return { ok: false, error: LINK_INVALID };

  const now = new Date();
  const [declined, meta] = await Promise.all([
    prisma.proposal.updateMany({
      where: { id, status: "SENT", archivedAt: null, linkVersion: claims.version, expiresAt: { gt: now } },
      data: { status: "DECLINED", declinedAt: now, declineReason: parsed.data.reason || null },
    }),
    requestMeta(),
  ]);

  const [p] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      select: {
        status: true,
        title: true,
        linkVersion: true,
        archivedAt: true,
        leadId: true,
        recipientName: true,
        lead: { select: { name: true } },
      },
    }),
    declined.count > 0
      ? prisma.proposalEvent.create({
          data: {
            proposalId: id,
            type: "DECLINED",
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            ...(parsed.data.reason ? { meta: { reason: parsed.data.reason } } : {}),
          },
        })
      : Promise.resolve(null),
  ]);
  if (!p) return { ok: false, error: "Proposal not found." };
  if (declined.count === 0) {
    // A second click on the same answer is not an error.
    if (p.status === "DECLINED") return { ok: true };
    if (p.status === "ACCEPTED") return { ok: false, error: "This proposal was already accepted." };
    if (p.archivedAt) return { ok: false, error: "This proposal was withdrawn." };
    if (claims.version !== p.linkVersion) return { ok: false, error: LINK_REPLACED };
    return { ok: false, error: "This proposal is no longer open." };
  }

  const who = p.lead?.name ?? p.recipientName ?? "The client";
  after(async () => {
    await notifyAllAdmins({
      type: "PROPOSAL_DECLINED",
      title: `${who} declined "${p.title}"`,
      body: parsed.data.reason ? `“${parsed.data.reason.slice(0, 300)}”` : "No reason given",
      link: proposalHref(id),
    });
    await logActivity({
      type: "proposal.declined",
      summary: `${who} declined "${p.title}"`,
      entity: "proposal",
      entityId: id,
      link: proposalHref(id),
    });
  });

  revalidateProposalViews(p.leadId);
  return { ok: true };
}

/**
 * PUBLIC action, called by the public page once it has mounted. Counting from
 * the browser rather than the server render is deliberate: link scanners
 * (Outlook SafeLinks and friends) fetch every link in an email but don't run
 * JavaScript, so they never look like the client opening it. A team session
 * previewing the page doesn't count either.
 *
 * One statement does the counting, the audit row and the lookup for the
 * notification, because this runs on every open of every proposal.
 */
export async function recordProposalView(id: string, token: string): Promise<void> {
  const claims = readProposalLink(id, token);
  if (!claims) return;
  const session = await getSession();
  if (session && session.user.role !== "CLIENT") return;
  const { ipAddress, userAgent } = await requestMeta();
  const now = new Date();

  const rows = await prisma.$queryRaw<{ viewCount: number; title: string; name: string | null }[]>`
    WITH viewed AS (
      UPDATE proposals
      SET "viewCount" = "viewCount" + 1,
          "lastViewedAt" = ${now}::timestamp,
          "firstViewedAt" = COALESCE("firstViewedAt", ${now}::timestamp)
      WHERE id = ${id}
        AND status = 'SENT'
        AND "archivedAt" IS NULL
        AND "linkVersion" = ${claims.version}
        AND "expiresAt" > ${now}::timestamp
      RETURNING id, "viewCount", title, "leadId", "recipientName"
    ), logged AS (
      INSERT INTO proposal_events (id, "proposalId", type, "ipAddress", "userAgent", "createdAt")
      SELECT ${randomUUID()}, viewed.id, 'VIEWED'::"ProposalEventType", ${ipAddress}, ${userAgent}, ${now}::timestamp
      FROM viewed
    )
    SELECT viewed."viewCount" AS "viewCount", viewed.title, COALESCE(l.name, viewed."recipientName") AS name
    FROM viewed LEFT JOIN leads l ON l.id = viewed."leadId"`;

  const row = rows[0];
  // Tell the owner once, on the first open; the card keeps the count after that.
  if (row && row.viewCount === 1) {
    after(() =>
      notifyAllAdmins({
        type: "PROPOSAL_VIEWED",
        title: `${row.name ?? "The client"} opened "${row.title}"`,
        body: "First view of the proposal link",
        link: proposalHref(id),
      }),
    );
  }
}
