import { Dancing_Script } from "next/font/google";

/**
 * The typed signature's face (SIGNATURE_FONT) on the page and the
 * certificate. Loaded only where a signature is shown, not app-wide. The
 * signed PDF registers the same family from public/fonts (proposal-pdf.tsx),
 * so a typed signature reads the same in both.
 */
export const signatureFont = Dancing_Script({
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
