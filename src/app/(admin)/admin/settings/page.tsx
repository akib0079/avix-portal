import {
  listPaymentAccounts,
  getWhatsappSupportUrl,
  getBranding,
  getInvoiceFooter,
} from "@/lib/dal/settings";
import { PageHeader } from "@/components/page-header";
import { PaymentAccountManager } from "@/components/settings/payment-account-manager";
import { WhatsappSetting } from "@/components/settings/whatsapp-setting";
import { BrandingSetting } from "@/components/settings/branding-setting";
import { InvoiceFooterSetting } from "@/components/settings/invoice-footer-setting";
import { TeamManager } from "@/components/settings/team-manager";
import { AvailabilityManager } from "@/components/settings/availability-manager";
import { GoogleCalendarSetting } from "@/components/settings/google-calendar-setting";
import { listStaff } from "@/lib/dal/users";
import { listAvailabilityWindows, getBookingConfig } from "@/lib/dal/availability";
import { calendarStatus } from "@/lib/google-calendar";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gcal?: string }>;
}) {
  await requireAdmin();
  const [{ gcal: gcalResult }, [accounts, whatsappUrl, branding, staff, availWindows, bookingConfig, invoiceFooter]] =
    await Promise.all([
      searchParams,
      Promise.all([
        listPaymentAccounts(),
        getWhatsappSupportUrl(),
        getBranding(),
        listStaff(),
        listAvailabilityWindows(),
        getBookingConfig(),
        getInvoiceFooter(),
      ]),
    ]);
  const gcal = await calendarStatus();

  const gcalBanner =
    gcalResult === "connected"
      ? { tone: "ok", text: "Google Calendar connected." }
      : gcalResult === "unconfigured"
        ? { tone: "err", text: "Google isn't configured on the server yet — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET." }
        : gcalResult === "error"
          ? { tone: "err", text: "Couldn't connect Google Calendar — check the redirect URI and Calendar scope, then retry." }
          : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage payment details and portal configuration."
      />
      {gcalBanner && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            gcalBanner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {gcalBanner.text}
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          <BrandingSetting
            color={branding.color}
            logoUrl={branding.logoFile ? `/api/branding/${branding.logoFile}` : null}
            faviconUrl={branding.faviconFile ? `/api/branding/${branding.faviconFile}` : null}
            invoiceLogoUrl={branding.invoiceLogoFile ? `/api/branding/${branding.invoiceLogoFile}` : null}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <InvoiceFooterSetting initial={invoiceFooter} />
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
          <GoogleCalendarSetting connected={gcal.connected} email={gcal.email} />
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
