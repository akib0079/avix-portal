"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/dal/session";
import { sendPasswordLink } from "@/lib/auth-utils";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { milestoneTemplates, textToDoc } from "@/lib/milestone-templates";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { proposalContact } from "@/lib/dal/proposals";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { usd } from "@/lib/format";
import {
  proposalSchema,
  acceptProposalSchema,
  type ProposalInput,
} from "@/lib/validation/proposal";
import { createProposalToken, verifyProposalToken } from "@/lib/marketing-token";
import ProposalSentEmail from "@/emails/proposal-sent";
import type { LeadSource, ProjectSource } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Lead source → the project's source enum (only Fiverr/Upwork map 1:1). */
function mapSource(source: LeadSource | null): ProjectSource {
  if (source === "FIVERR") return "FIVERR";
  if (source === "UPWORK") return "UPWORK";
  return "INDEPENDENT";
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
function recipientFields(data: ProposalInput) {
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

export async function createProposal(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = parsePayload(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  if (data.source === "lead") {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId as string },
      select: { id: true },
    });
    if (!lead) return { ok: false, error: "Lead not found." };
  }

  const pdf = await handleInvoicePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  const proposal = await prisma.proposal.create({
    data: {
      ...recipientFields(data),
      title: data.title,
      intro: data.intro || null,
      projectType: data.projectType,
      timelineWeeks: data.timelineWeeks ?? null,
      depositPercent: data.depositPercent,
      expiresInDays: data.expiresInDays,
      invoicePdfPath: pdf.fileName,
      invoicePdfOriginalName: pdf.originalName,
      invoicePdfExternalUrl: data.invoicePdfExternalUrl || null,
      items: { create: itemsFromInput(data.items) },
    },
  });

  revalidatePath("/admin/proposals");
  return { ok: true, data: { id: proposal.id } };
}

export async function updateProposal(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = parsePayload(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const existing = await prisma.proposal.findUnique({
    where: { id },
    select: { status: true, invoicePdfPath: true, invoicePdfOriginalName: true },
  });
  if (!existing) return { ok: false, error: "Proposal not found." };
  if (existing.status !== "DRAFT") {
    return { ok: false, error: "Only draft proposals can be edited." };
  }
  if (data.source === "lead") {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId as string },
      select: { id: true },
    });
    if (!lead) return { ok: false, error: "Lead not found." };
  }

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

  await prisma.$transaction(async (tx) => {
    await tx.proposalItem.deleteMany({ where: { proposalId: id } });
    await tx.proposal.update({
      where: { id },
      data: {
        ...recipientFields(data),
        title: data.title,
        intro: data.intro || null,
        projectType: data.projectType,
        timelineWeeks: data.timelineWeeks ?? null,
        depositPercent: data.depositPercent,
        expiresInDays: data.expiresInDays,
        invoicePdfPath: nextPdfPath,
        invoicePdfOriginalName: nextPdfName,
        invoicePdfExternalUrl: data.invoicePdfExternalUrl || null,
        items: { create: itemsFromInput(data.items) },
      },
    });
  });

  // Drop the superseded file only after the row is safely updated.
  if ((replacing || clearing) && existing.invoicePdfPath) {
    await deleteUpload("invoices", existing.invoicePdfPath);
  }

  revalidatePath("/admin/proposals");
  return { ok: true };
}

export async function deleteProposal(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, invoicePdfPath: true, convertedInvoiceId: true },
  });
  if (!existing) return { ok: false, error: "Proposal not found." };

  await prisma.proposal.delete({ where: { id } });

  // Accepted proposals hand the same file to their deposit invoice — deleting
  // it here would break that invoice's download.
  if (existing.invoicePdfPath && !existing.convertedInvoiceId) {
    await deleteUpload("invoices", existing.invoicePdfPath);
  }

  revalidatePath("/admin/proposals");
  return { ok: true };
}

/** Marks a proposal SENT, stamps the expiry window, and emails the recipient. */
export async function sendProposal(id: string): Promise<ActionResult> {
  await requireAdmin();
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { name: true, email: true, company: true, stage: true } },
    },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status === "ACCEPTED") {
    return { ok: false, error: "This proposal was already accepted." };
  }

  const contact = proposalContact(proposal);
  if (!contact.email) {
    return {
      ok: false,
      error: proposal.leadId
        ? "Add an email to this lead first — the proposal is sent to it."
        : "Add a recipient email first — the proposal is sent to it.",
    };
  }

  const expiresAt = new Date(Date.now() + proposal.expiresInDays * 24 * 60 * 60 * 1000);
  const token = createProposalToken(id, expiresAt.getTime());
  const acceptUrl = `${appUrl()}/proposals/${id}?token=${token}`;
  const total = proposal.items.reduce((acc, i) => acc + Number(i.amount), 0);

  await prisma.proposal.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      expiresAt,
      // Nudge a pipeline lead into the Proposal-sent column (never downgrade Won/Lost).
      lead:
        proposal.lead &&
        (proposal.lead.stage === "NEW" || proposal.lead.stage === "CONTACTED")
          ? { update: { stage: "PROPOSAL" } }
          : undefined,
    },
  });

  const [firstName] = contact.name.trim().split(/\s+/);
  await sendEmail({
    to: contact.email,
    subject: `Your proposal from Avix Digital: ${proposal.title}`,
    react: (
      <ProposalSentEmail
        recipientName={firstName || contact.name}
        title={proposal.title}
        intro={proposal.intro}
        totalText={usd.format(total)}
        timelineText={
          proposal.timelineWeeks
            ? `Timeline: ${proposal.timelineWeeks} week${proposal.timelineWeeks === 1 ? "" : "s"}`
            : null
        }
        validUntilText={expiresAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        acceptUrl={acceptUrl}
      />
    ),
    devHint: `proposal ${proposal.title} → ${contact.email}`,
  });

  revalidatePath("/admin/proposals");
  revalidatePath("/admin/leads");
  return { ok: true };
}

/** Re-derives the public accept link for a sent proposal (for "Copy link"). */
export async function getProposalLink(id: string): Promise<ActionResult<{ url: string }>> {
  await requireAdmin();
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { expiresAt: true, status: true },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (!proposal.expiresAt) {
    return { ok: false, error: "Send the proposal first to create its link." };
  }
  const token = createProposalToken(id, proposal.expiresAt.getTime());
  return { ok: true, data: { url: `${appUrl()}/proposals/${id}?token=${token}` } };
}

/**
 * The shared hand-off, used by BOTH the public accept and the admin's
 * "mark accepted". Atomically creates the CLIENT account, a CONTRACT project
 * priced at the proposal total, and a draft deposit invoice; marks a backing
 * lead WON and stamps the signature on the proposal.
 *
 * Callers must have already authorised the action (token or admin session).
 */
async function runHandoff(
  id: string,
  signedName: string,
  byAdmin: boolean,
): Promise<ActionResult<{ accepted: true }>> {
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { id: true, name: true, email: true, company: true, source: true } },
    },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status === "ACCEPTED") return { ok: true, data: { accepted: true } };
  // The admin may close a proposal that was never sent; the client cannot.
  if (byAdmin ? proposal.status === "DECLINED" : proposal.status !== "SENT") {
    return { ok: false, error: "This proposal is no longer available." };
  }

  const contact = proposalContact(proposal);
  if (!contact.email) {
    return { ok: false, error: "No contact email on file for this proposal." };
  }

  const email = contact.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return {
      ok: false,
      error: byAdmin
        ? "A client account already exists for this email."
        : "An account already exists for this email — please sign in instead.",
    };
  }

  const total = proposal.items.reduce((acc, i) => acc + Number(i.amount), 0);
  const depositAmount = Math.round(total * proposal.depositPercent) / 100;
  const [firstName, ...rest] = contact.name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  // Hash outside the transaction (better-auth context is independent of the tx).
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(randomBytes(24).toString("base64url"));
  const template = milestoneTemplates[proposal.projectType];

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: contact.name.trim(),
        firstName: firstName ?? contact.name,
        lastName,
        role: "CLIENT",
        company: contact.company,
        emailVerified: false,
      },
    });
    await tx.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash },
    });

    const project = await tx.project.create({
      data: {
        projectName: proposal.title,
        clientId: user.id,
        type: proposal.projectType,
        source: mapSource(proposal.lead?.source ?? null),
        priority: "MEDIUM",
        status: "PLANNING",
        billingType: "CONTRACT",
        contractPrice: total,
        milestones: {
          create: template.map((m, index) => ({
            title: m.title,
            description: textToDoc(m.description),
            position: index,
          })),
        },
      },
    });

    const invoiceNumber = await nextInvoiceNumber(tx);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        clientId: user.id,
        projectId: project.id,
        amount: depositAmount,
        status: "ASSIGNED",
        issueDate: new Date(),
        title: `${proposal.title} — ${proposal.depositPercent}% deposit`,
        notes: `${proposal.depositPercent}% deposit for "${proposal.title}"`,
        // Carry the invoice document attached in the builder, so the client
        // gets the paperwork with the deposit invoice.
        pdfPath: proposal.invoicePdfPath,
        pdfOriginalName: proposal.invoicePdfOriginalName,
        pdfExternalUrl: proposal.invoicePdfExternalUrl,
        // A line item so the generated PDF is complete without editing.
        items: {
          create: [
            {
              description: `${proposal.title} — ${proposal.depositPercent}% deposit`,
              qty: 1,
              rate: depositAmount,
              sortOrder: 0,
            },
          ],
        },
      },
    });

    if (proposal.lead) {
      await tx.lead.update({
        where: { id: proposal.lead.id },
        data: { stage: "WON", convertedClientId: user.id },
      });
    }

    await tx.proposal.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedName: signedName,
        acceptedByAdmin: byAdmin,
        convertedClientId: user.id,
        convertedProjectId: project.id,
        convertedInvoiceId: invoice.id,
      },
    });

    return { user, project, invoice };
  });

  // Send the set-your-password invite (outside the tx; safe to be non-atomic).
  await sendPasswordLink(email);

  // Only notify for a client-driven accept — the admin already knows about theirs.
  if (!byAdmin) {
    await notifyAllAdmins({
      type: "PROPOSAL_ACCEPTED",
      title: `${contact.name} accepted "${proposal.title}"`,
      body: `${usd.format(total)} · deposit invoice ${result.invoice.invoiceNumber} drafted (${usd.format(depositAmount)})`,
      link: "/admin/proposals",
    });
  }

  revalidatePath("/admin/proposals");
  revalidatePath("/admin/leads");
  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return { ok: true, data: { accepted: true } };
}

/**
 * PUBLIC action (no session). A prospect accepts by typing their name.
 * Re-verifies the signed token + expiry server-side before doing anything.
 * Idempotent on an already-accepted proposal.
 */
export async function acceptProposal(
  id: string,
  token: string,
  signedName: string,
): Promise<ActionResult<{ accepted: true }>> {
  const parsed = acceptProposalSchema.safeParse({ signedName });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Type your full name" };
  }
  if (!verifyProposalToken(id, token)) {
    return { ok: false, error: "This proposal link is invalid or has expired." };
  }
  return runHandoff(id, parsed.data.signedName, false);
}

/**
 * Admin closes the proposal on the client's behalf (they agreed by call/chat).
 * Runs the same hand-off; the signature records who agreed, flagged as
 * admin-recorded so the audit trail stays honest.
 */
export async function markProposalAccepted(
  id: string,
  signedName: string,
): Promise<ActionResult<{ accepted: true }>> {
  await requireAdmin();
  const parsed = acceptProposalSchema.safeParse({ signedName });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter who agreed" };
  }
  return runHandoff(id, parsed.data.signedName, true);
}

/** Optional: a prospect declines the proposal. */
export async function declineProposal(id: string, token: string): Promise<ActionResult> {
  if (!verifyProposalToken(id, token)) {
    return { ok: false, error: "This proposal link is invalid or has expired." };
  }
  const proposal = await prisma.proposal.findUnique({ where: { id }, select: { status: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status === "ACCEPTED") {
    return { ok: false, error: "This proposal was already accepted." };
  }
  await prisma.proposal.update({ where: { id }, data: { status: "DECLINED" } });
  revalidatePath("/admin/proposals");
  return { ok: true };
}
