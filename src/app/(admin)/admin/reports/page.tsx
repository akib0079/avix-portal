import { getReportsData } from "@/lib/dal/reports";
import { requireAdmin } from "@/lib/dal/session";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireAdmin();
  const data = await getReportsData();
  return <ReportsView data={data} />;
}
