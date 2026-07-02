import { redirect } from "next/navigation";
import { getSession } from "@/lib/dal/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.user.role === "ADMIN" ? "/admin" : "/portal");
}
