import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

// Render on every request (not statically prerendered/CDN-cached for a year),
// so the form is in the server HTML and design/content changes show up
// immediately instead of being served stale by the CDN.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
