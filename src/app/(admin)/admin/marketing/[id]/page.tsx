import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/dal/marketing";
import { requireAdmin } from "@/lib/dal/session";
import { CampaignDetail } from "@/components/marketing/campaign-detail";

export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  return <CampaignDetail campaign={campaign} />;
}
