import { listPaymentAccounts, getWhatsappSupportUrl } from "@/lib/dal/settings";
import { PageHeader } from "@/components/page-header";
import { PaymentAccountManager } from "@/components/settings/payment-account-manager";
import { WhatsappSetting } from "@/components/settings/whatsapp-setting";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [accounts, whatsappUrl] = await Promise.all([
    listPaymentAccounts(),
    getWhatsappSupportUrl(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage payment details and portal configuration."
      />
      <Card>
        <CardContent className="pt-6">
          <PaymentAccountManager accounts={accounts} />
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
