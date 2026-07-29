"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Loader2, MailCheck, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Always show success — never reveal whether an email exists.
    await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-tint">
          <MailCheck className="size-6 text-success" />
        </div>
        <h2 className="font-heading mt-4 text-2xl font-bold">Check your inbox</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium">{email}</span>,
          we&apos;ve sent a link to reset your password. The link is valid for
          24 hours.
        </p>
        <Button asChild variant="outline" className="mt-6 h-12 rounded-full px-6">
          <Link href="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-heading text-3xl font-bold tracking-tight">Reset your password</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your account email and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="sr-only">
            Email
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 rounded-full pl-11"
            />
          </div>
        </div>
        <Button
          type="submit"
          className="group h-12 w-full rounded-full border-0 bg-gradient-to-r from-[#fb7a3c] to-[#f65d0b] text-[15px] text-white shadow-md shadow-primary/20 transition-opacity hover:opacity-95"
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : null}
          Send reset link
          {!loading && (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </Button>
      </form>

      <p className="mt-6 text-center">
        <Link
          href="/login"
          className="text-xs font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
