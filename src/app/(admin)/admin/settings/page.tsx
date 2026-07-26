import {
  listPaymentAccounts,
  getWhatsappSupportUrl,
  getBranding,
} from "@/lib/dal/settings";
import { PageHeader } from "@/components/page-header";
import { PaymentAccountManager } from "@/components/settings/payment-account-manager";
import { WhatsappSetting } from "@/components/settings/whatsapp-setting";
import { BrandingSetting } from "@/components/settings/branding-setting";
import { TeamManager } from "@/components/settings/team-manager";
import { AvailabilityManager } from "@/components/settings/availability-manager";
import { listStaff } from "@/lib/dal/users";
import { listAvailabilityWindows, getBookingConfig } from "@/lib/dal/availability";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const [accounts, whatsappUrl, branding, staff, availWindows, bookingConfig] =
    await Promise.all([
      listPaymentAccounts(),
      getWhatsappSupportUrl(),
      getBranding(),
      listStaff(),
      listAvailabilityWindows(),
      getBookingConfig(),
    ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage payment details and portal configuration."
      />
      <Card>
        <CardContent className="pt-6">
          <BrandingSetting
            color={branding.color}
            logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
            faviconUrl={branding.faviconFile ? `/api/branding/${branding.faviconFile}` : null}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <TeamManager staff={staff} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <PaymentAccountManager accounts={accounts} />
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardContent className="pt-6">
          <AvailabilityManager
            timezone={bookingConfig.agencyTimezone}
            slotMinutes={bookingConfig.slotMinutes}
            bookingUrl={bookingConfig.bookingUrl}
            windows={availWindows.map((w) => ({
              weekday: w.weekday,
              startMin: w.startMin,
              endMin: w.endMin,
            }))}
          />
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardContent className="pt-6">
          <WhatsappSetting initialUrl={whatsappUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
