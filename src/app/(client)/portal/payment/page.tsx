import { requireClient } from "@/lib/dal/session";
import { listActivePaymentAccounts, getPaymentGuideUrl } from "@/lib/dal/settings";
import { PaymentGuideButton } from "@/components/payments/payment-guide-button";
import { PageHeader } from "@/components/page-header";
import { PaymentDetails } from "@/components/payments/payment-details";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

export const metadata = { title: "How to Pay" };

export default async function ClientPaymentPage() {
  await requireClient();
  const [accounts, guideUrl] = await Promise.all([
    listActivePaymentAccounts(),
    getPaymentGuideUrl(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="How to pay"
        description="Settle invoices by bank transfer using the details below."
      />

      {guideUrl && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-brand-tint/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Step-by-step payment guide</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              How to send payment through Wise, with our bank details and what to
              use as the reference.
            </p>
          </div>
          <PaymentGuideButton url={guideUrl} className="shrink-0" />
        </div>
      )}

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CreditCard className="size-6 text-muted-foreground" />
            </div>
            <p className="mt-4 font-medium">Payment details coming soon</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reach out to Avix Digital for payment instructions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose the region that matches your bank, then tap any value to copy
            it. Always include your invoice number as the payment reference.
          </p>
          <PaymentDetails accounts={accounts} />
        </>
      )}
    </div>
  );
}
