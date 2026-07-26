"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** App theme provider — class strategy, system default, no flash. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
