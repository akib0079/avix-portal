/**
 * Supported invoice/proposal currencies.
 *
 * The symbol was a `currency === "EUR" ? "€" : "$"` ternary in four separate
 * files, which quietly meant every dollar-family currency printed a bare "$" —
 * fine until you invoice a Canadian and an Australian client in the same month
 * and neither document says which dollar it is.
 *
 * Dependency-free so the PDF renderer, the form and the server can share it.
 */

export const CURRENCIES = [
  { code: "USD", symbol: "$", label: "USD ($)" },
  { code: "EUR", symbol: "€", label: "EUR (€)" },
  { code: "GBP", symbol: "£", label: "GBP (£)" },
  { code: "CAD", symbol: "C$", label: "CAD (C$)" },
  { code: "AUD", symbol: "A$", label: "AUD (A$)" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const currencyCodes = CURRENCIES.map((c) => c.code) as unknown as [
  CurrencyCode,
  ...CurrencyCode[],
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** "C$" for CAD, "A$" for AUD — never a bare "$" for a non-US dollar. */
export function currencySymbol(code: string | null | undefined): string {
  return BY_CODE.get((code ?? "USD") as CurrencyCode)?.symbol ?? "$";
}

/** Amount in its own currency, e.g. "C$1,250.00". */
export function formatCurrency(amount: number, code: string | null | undefined): string {
  return `${currencySymbol(code)}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
