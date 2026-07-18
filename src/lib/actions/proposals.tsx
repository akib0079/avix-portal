"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/dal/session";
import { sendPasswordLink } from "@/lib/auth-utils";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { milestoneTemplates, textToDoc } from "@/lib/milestone-templates";
import { notifyAllAdmins } from "@/lib/dal/notifications";
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
function mapSource(source: LeadSource): ProjectSource {
  if (source === "FIVERR") return "FIVERR";
  if (source === "UPWORK") return "UPWORK";
  return "INDEPENDENT";
}

function itemsFromInput(items: ProposalInput["items"]) {
  return items.map((item, index) => ({
    description: item.description,
    amount: item.amount,
    sortOrder: index,
  }));
}

export async function createProposal(
  input: ProposalInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: data.leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Lead not found." };

  const proposal = await prisma.proposal.create({
    data: {
      leadId: data.leadId,
      title: data.title,
      intro: data.intro || null,
      projectType: data.projectType,
      timelineWeeks: data.timelineWeeks ?? null,
      depositPercent: data.depositPercent,
      expiresInDays: data.expiresInDays,
      items: { create: itemsFromInput(data.items) },
    },
  });

  revalidatePath("/admin/proposals");
  return { ok: true, data: { id: proposal.id } };
}

export async function updateProposal(
  id: string,
  input: ProposalInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const existing = await prisma.proposal.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return { ok: false, error: "Proposal not found." };
  if (existing.status !== "DRAFT") {
    return { ok: false, error: "Only draft proposals can be edited." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.proposalItem.deleteMany({ where: { proposalId: id } });
    await tx.proposal.update({
      where: { id },
      data: {
        title: data.title,
        intro: data.intro || null,
        projectType: data.projectType,
        timelineWeeks: data.timelineWeeks ?? null,
        depositPercent: data.depositPercent,
        expiresInDays: data.expiresInDays,
        items: { create: itemsFromInput(data.items) },
      },
    });
  });

  revalidatePath("/admin/proposals");
  return { ok: true };
}

export async function deleteProposal(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.proposal.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, error: "Proposal not found." };
  await prisma.proposal.delete({ where: { id } });
  revalidatePath("/admin/proposals");
  return { ok: true };
}

/** Marks a proposal SENT, stamps the expiry window, and emails the prospect. */
export async function sendProposal(id: string): Promise<ActionResult> {
  await requireAdmin();
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { name: true, email: true, stage: true } },
    },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status === "ACCEPTED") {
    return { ok: false, error: "This proposal was already accepted." };
  }
  if (!proposal.lead.email) {
    return { ok: false, error: "Add an email to this lead first — the proposal is sent to it." };
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
      // Nudge the lead into the Proposal-sent column (never downgrade Won/Lost).
      lead:
        proposal.lead.stage === "NEW" || proposal.lead.stage === "CONTACTED"
          ? { update: { stage: "PROPOSAL" } }
          : undefined,
    },
  });

  const [firstName] = proposal.lead.name.trim().split(/\s+/);
  await sendEmail({
    to: proposal.lead.email,
    subject: `Your proposal from Avix Digital: ${proposal.title}`,
    react: (
      <ProposalSentEmail
        recipientName={firstName || proposal.lead.name}
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
    devHint: `proposal ${proposal.title} → ${proposal.lead.email}`,
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
 * PUBLIC action (no session). A prospect accepts a proposal by typing their
 * name. Re-verifies the signed token + expiry server-side, then atomically:
 * creates the CLIENT account, a CONTRACT project priced at the proposal total,
 * a draft deposit invoice, marks the lead WON, and stamps the signature.
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

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { id: true, name: true, email: true, company: true, source: true } },
    },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status === "ACCEPTED") return { ok: true, data: { accepted: true } };
  if (proposal.status !== "SENT") {
    return { ok: false, error: "This proposal is no longer available." };
  }
  if (!proposal.lead.email) {
    return { ok: false, error: "This proposal can't be accepted — no contact email on file." };
  }

  const email = proposal.lead.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { ok: false, error: "An account already exists for this email — please sign in instead." };
  }

  const total = proposal.items.reduce((acc, i) => acc + Number(i.amount), 0);
  const depositAmount = Math.round(total * proposal.depositPercent) / 100;
  const [firstName, ...rest] = proposal.lead.name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  // Hash outside the transaction (better-auth context is independent of the tx).
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(randomBytes(24).toString("base64url"));
  const template = milestoneTemplates[proposal.projectType];

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: proposal.lead.name.trim(),
        firstName: firstName ?? proposal.lead.name,
        lastName,
        role: "CLIENT",
        company: proposal.lead.company,
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
        source: mapSource(proposal.lead.source),
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
        notes: `${proposal.depositPercent}% deposit for "${proposal.title}"`,
      },
    });

    await tx.lead.update({
      where: { id: proposal.lead.id },
      data: { stage: "WON", convertedClientId: user.id },
    });

    await tx.proposal.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedName: parsed.data.signedName,
        convertedProjectId: project.id,
        convertedInvoiceId: invoice.id,
      },
    });

    return { user, project, invoice };
  });

  // Send the set-your-password invite (outside the tx; safe to be non-atomic).
  await sendPasswordLink(email);

  await notifyAllAdmins({
    type: "PROPOSAL_ACCEPTED",
    title: `${proposal.lead.name} accepted "${proposal.title}"`,
    body: `${usd.format(total)} · deposit invoice ${result.invoice.invoiceNumber} drafted (${usd.format(depositAmount)})`,
    link: "/admin/proposals",
  });

  revalidatePath("/admin/proposals");
  revalidatePath("/admin/leads");
  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return { ok: true, data: { accepted: true } };
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
