import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { PaymentField } from "@/lib/validation/payment";
import type { PaymentAccount } from "@prisma/client";

/**
 * Cache tag for everything in AppSetting + PaymentAccount.
 *
 * These are read on EVERY page render (branding sits in both layouts) and
 * change a few times a year, so they were costing one database round trip per
 * navigation for nothing. Cached across requests and busted explicitly by the
 * settings actions — see revalidateSettings().
 */
export const SETTINGS_CACHE_TAG = "app-settings";


/** Serialized payment account safe for client components. */
export type PaymentAccountView = {
  id: string;
  title: string;
  region: PaymentAccount["region"];
  holderName: string;
  bankName: string;
  bankNote: string | null;
  note: string | null;
  isActive: boolean;
  position: number;
  fields: PaymentField[];
};

function toView(a: PaymentAccount): PaymentAccountView {
  return {
    id: a.id,
    title: a.title,
    region: a.region,
    holderName: a.holderName,
    bankName: a.bankName,
    bankNote: a.bankNote,
    note: a.note,
    isActive: a.isActive,
    position: a.position,
    fields: (a.fields as PaymentField[]) ?? [],
  };
}

/** All accounts, admin-only (Settings page). */
export async function listPaymentAccounts(): Promise<PaymentAccountView[]> {
  await requireAdmin();
  const rows = await prisma.paymentAccount.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

/** Active accounts only — shown to clients. No auth scoping needed (public
 *  bank details), but callers are already inside authenticated routes. */
export const listActivePaymentAccounts = unstable_cache(
  async (): Promise<PaymentAccountView[]> => {
    const rows = await prisma.paymentAccount.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(toView);
  },
  ["active-payment-accounts"],
  { tags: [SETTINGS_CACHE_TAG], revalidate: 300 },
);

export const WHATSAPP_SETTING_KEY = "whatsappSupportUrl";

/** Admin-editable WhatsApp support link, or null when not configured. */
export const getWhatsappSupportUrl = unstable_cache(
  async (): Promise<string | null> => {
    const row = await prisma.appSetting.findUnique({
      where: { key: WHATSAPP_SETTING_KEY },
    });
    return row?.value || null;
  },
  ["whatsapp-support-url"],
  { tags: [SETTINGS_CACHE_TAG], revalidate: 300 },
);

export const BRAND_KEYS = {
  color: "brandColor",
  logo: "brandLogoFile",
  favicon: "brandFaviconFile",
  /** Biller's signature image (PNG/JPG) stamped on generated invoice PDFs. */
  signature: "brandSignatureFile",
  /** Dedicated invoice logo (PNG/JPG). Separate from the web logo, which is
   *  light-on-dark; invoices need a dark logo on white. Falls back to the
   *  bundled dark avix-logo.png. */
  invoiceLogo: "brandInvoiceLogoFile",
} as const;

/** Invoice footer note (e.g. preferred payment method). */
export const INVOICE_FOOTER_KEY = "invoiceFooter";
export const DEFAULT_INVOICE_FOOTER =
  "Please use wise.com or your personal bank network to do the payment.";

export const getInvoiceFooter = unstable_cache(
  async (): Promise<string> => {
    const row = await prisma.appSetting.findUnique({ where: { key: INVOICE_FOOTER_KEY } });
    // Unset → default text; explicitly emptied (whitespace) → no footer.
    return row ? row.value : DEFAULT_INVOICE_FOOTER;
  },
  ["invoice-footer"],
  { tags: [SETTINGS_CACHE_TAG], revalidate: 300 },
);

export type Branding = {
  color: string | null;
  logoFile: string | null;
  faviconFile: string | null;
  signatureFile: string | null;
  invoiceLogoFile: string | null;
};

/**
 * Admin-set branding (color + logo/favicon file names). Public-safe.
 * `cache()` dedupes the read within a single request — the root layout reads
 * it in both generateMetadata and the layout component.
 */
const loadBranding = unstable_cache(
  async (): Promise<Branding> => {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [BRAND_KEYS.color, BRAND_KEYS.logo, BRAND_KEYS.favicon, BRAND_KEYS.signature, BRAND_KEYS.invoiceLogo],
      },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    color: map[BRAND_KEYS.color] || null,
    logoFile: map[BRAND_KEYS.logo] || null,
    faviconFile: map[BRAND_KEYS.favicon] || null,
    signatureFile: map[BRAND_KEYS.signature] || null,
    invoiceLogoFile: map[BRAND_KEYS.invoiceLogo] || null,
  };
  },
  ["branding"],
  { tags: [SETTINGS_CACHE_TAG], revalidate: 300 },
);

/** react cache() dedupes within a request; unstable_cache spans requests. */
export const getBranding = cache((): Promise<Branding> => loadBranding());
