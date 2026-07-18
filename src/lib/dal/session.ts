import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth, type SessionUser } from "@/lib/auth";

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") redirect("/login");
  return session.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  return user;
}

/**
 * ADMIN or STAFF. Use ONLY on the staff-safe surface (projects, messages,
 * milestones sans pricing, time entries). Money-bearing DAL/actions must keep
 * requireAdmin — an unmigrated call site fails closed (404 for staff).
 */
export async function requireTeam(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "STAFF") notFound();
  return user;
}

export async function requireClient(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "CLIENT") notFound();
  return user;
}
