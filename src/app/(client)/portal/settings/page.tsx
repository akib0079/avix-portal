import { requireClient } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProfileSettings } from "@/components/portal/profile-settings";

export const metadata = { title: "Settings" };

export default async function PortalSettingsPage() {
  const user = await requireClient();
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      phone: true,
      timezone: true,
      marketingOptOut: true,
    },
  });
  if (!me) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Your details, timezone, email preferences, and password."
      />
      <ProfileSettings profile={me} />
    </div>
  );
}
