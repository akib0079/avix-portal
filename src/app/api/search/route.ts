import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";

export type SearchHit = {
  group: "Clients" | "Projects" | "Invoices" | "Leads";
  label: string;
  detail: string;
  href: string;
};

/** Admin-only global search across clients, projects, invoices, and leads. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN" || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const contains = { contains: q, mode: "insensitive" as const };

  const [clients, projects, invoices, leads] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: "CLIENT",
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          { company: contains },
        ],
      },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, company: true },
    }),
    prisma.project.findMany({
      where: { projectName: contains },
      take: 5,
      select: {
        id: true,
        projectName: true,
        status: true,
        client: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        OR: [{ invoiceNumber: contains }, { notes: contains }],
      },
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        status: true,
        client: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.lead.findMany({
      where: {
        OR: [{ name: contains }, { company: contains }, { email: contains }],
      },
      take: 5,
      select: { id: true, name: true, company: true, stage: true },
    }),
  ]);

  const hits: SearchHit[] = [
    ...clients.map((c) => ({
      group: "Clients" as const,
      label: `${c.firstName} ${c.lastName}`.trim(),
      detail: [c.company, c.email].filter(Boolean).join(" · "),
      href: `/admin/clients/${c.id}`,
    })),
    ...projects.map((p) => ({
      group: "Projects" as const,
      label: p.projectName,
      detail: `${p.client ? `${p.client.firstName} ${p.client.lastName}` : "No client"} · ${p.status.replaceAll("_", " ").toLowerCase()}`,
      href: `/admin/projects/${p.id}`,
    })),
    ...invoices.map((i) => ({
      group: "Invoices" as const,
      label: i.invoiceNumber,
      detail: `${i.client.firstName} ${i.client.lastName} · $${Number(i.amount).toFixed(2)} · ${i.status.replaceAll("_", " ").toLowerCase()}`,
      href: `/admin/invoices/${i.id}`,
    })),
    ...leads.map((l) => ({
      group: "Leads" as const,
      label: l.name,
      detail: [l.company, l.stage.toLowerCase()].filter(Boolean).join(" · "),
      href: "/admin/leads",
    })),
  ];

  return NextResponse.json({ hits });
}
