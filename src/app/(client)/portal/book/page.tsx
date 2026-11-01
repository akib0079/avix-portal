import { requireClient } from "@/lib/dal/session";
import { getMyTimezone } from "@/lib/dal/portal";
import { deriveOpenSlots } from "@/lib/dal/availability";
import { PageHeader } from "@/components/page-header";
import { SlotPicker } from "@/components/portal/slot-picker";

export const metadata = { title: "Book a Meeting" };

export default async function BookMeetingPage() {
  await requireClient();
  // Never null: with no zone, SlotPicker would format in the server's UTC
  // during SSR and the browser's zone on hydration.
  const [timezone, { slots, config }] = await Promise.all([
    getMyTimezone(),
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
        timezone={timezone}
        slotMinutes={config.slotMinutes}
      />
    </div>
  );
}
