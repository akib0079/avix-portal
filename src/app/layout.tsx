import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { getBranding, type Branding } from "@/lib/dal/settings";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin"],
});

const NO_BRANDING: Branding = { color: null, logoFile: null, faviconFile: null, signatureFile: null };

async function branding(): Promise<Branding> {
  // Never let a slow/unavailable DB block the shell — fall back to defaults
  // after 3s (also keeps `next build` prerendering from stalling).
  try {
    return await Promise.race([
      getBranding(),
      new Promise<Branding>((resolve) => setTimeout(() => resolve(NO_BRANDING), 3000)),
    ]);
  } catch {
    return NO_BRANDING;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const b = await branding();
  // Single source of truth for the favicon. There is deliberately NO
  // app/favicon.ico or app/icon file convention — those would auto-inject a
  // /favicon.ico that browsers prefer over this, so an uploaded favicon could
  // never win. All rels point at the uploaded file, or the default /icon.png.
  const iconHref = b.faviconFile ? `/api/branding/${b.faviconFile}` : "/icon.png";
  return {
    title: {
      default: "Avix Digital Portal",
      template: "%s · Avix Digital",
    },
    description:
      "Client portal for Avix Digital — projects, milestones, and invoices in one place.",
    icons: {
      icon: iconHref,
      shortcut: iconHref,
      apple: iconHref,
    },
  };
}

// Slightly darker shade for hover states derived from the accent color.
function darken(hex: string, amount = 0.1): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) * (1 - amount));
  const g = Math.max(0, ((n >> 8) & 255) * (1 - amount));
  const b = Math.max(0, (n & 255) * (1 - amount));
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const b = await branding();
  const brandCss =
    b.color && /^#[0-9a-fA-F]{6}$/.test(b.color)
      ? `:root{--primary:${b.color};--brand:${b.color};--brand-hover:${darken(b.color)};}`
      : null;

  return (
    // suppressHydrationWarning: browser extensions (Grammarly, Scribe, …)
    // inject attributes onto <html>/<body> before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
