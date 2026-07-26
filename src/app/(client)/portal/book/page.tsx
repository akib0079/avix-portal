import { requireClient } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { deriveOpenSlots } from "@/lib/dal/availability";
import { PageHeader } from "@/components/page-header";
import { SlotPicker } from "@/components/portal/slot-picker";

export const metadata = { title: "Book a Meeting" };

export default async function BookMeetingPage() {
  const user = await requireClient();
  const [me, { slots, config }] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    deriveOpenSlots(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Book a Meeting"
        description="Pick a time that works for you — we'll confirm by email with a calendar invite."
      />
      <SlotPicker
        slots={slots}
        timezone={me?.timezone ?? null}
        slotMinutes={config.slotMinutes}
      />
    </div>
  );
}
