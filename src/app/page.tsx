import { redirect } from "next/navigation";
import { getSession } from "@/lib/dal/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { role } = session.user;
  // Staff land on projects — /admin is the revenue dashboard (admin-only).
  redirect(role === "ADMIN" ? "/admin" : role === "STAFF" ? "/admin/projects" : "/portal");
}
