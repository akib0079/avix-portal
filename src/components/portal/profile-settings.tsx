"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMyProfile } from "@/lib/actions/profile";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Save, User, Lock, Bell, Globe } from "lucide-react";

export type ClientProfile = {
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  timezone: string | null;
  marketingOptOut: boolean;
};

export function ProfileSettings({ profile }: { profile: ClientProfile }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [company, setCompany] = useState(profile.company ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [timezone, setTimezone] = useState(profile.timezone ?? "");
  const [optOut, setOptOut] = useState(profile.marketingOptOut);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  function saveProfile() {
    startTransition(async () => {
      const res = await updateMyProfile({
        firstName,
        lastName,
        company,
        phone,
        timezone,
        marketingOptOut: optOut,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Profile saved.");
      router.refresh();
    });
  }

  function useDetectedTimezone() {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) {
      setTimezone(detected);
      toast.success(`Detected ${detected} — remember to save.`);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      return void toast.error("New password must be at least 8 characters.");
    }
    setPwBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPwBusy(false);
    if (error) {
      return void toast.error(error.message ?? "Couldn't change the password.");
    }
    setCurrentPassword("");
    setNewPassword("");
    toast.success("Password updated.");
  }

  return (
    <div className="space-y-6">
      {/* Your details */}
      <Card>
        <CardContent className="pt-6">
          <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
            <User className="size-5 text-primary" /> Your details
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is how we address you and reach you about your projects.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11 rounded-full px-4"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11 rounded-full px-4"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your company"
                className="h-11 rounded-full px-4"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="h-11 rounded-full px-4"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="timezone" className="flex items-center gap-1.5">
              <Globe className="size-3.5" /> Timezone
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/New_York"
                className="h-11 max-w-xs rounded-full px-4"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full"
                onClick={useDetectedTimezone}
              >
                Use my current timezone
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Meeting times and booking slots are shown in this zone.
            </p>
          </div>

          <div className="mt-5 space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Bell className="size-3.5" /> Email preferences
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm">
              <input
                type="checkbox"
                checked={!optOut}
                onChange={(e) => setOptOut(!e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span>
                Send me occasional updates and offers from Avix Digital.
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Project, invoice and meeting emails are always sent.
                </span>
              </span>
            </label>
          </div>

          <Button
            className="mt-5 h-11 rounded-full bg-gradient-to-r from-[#fb7a3c] to-[#f65d0b] text-white shadow-md shadow-primary/20 hover:opacity-95"
            onClick={saveProfile}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}
            Save changes
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardContent className="pt-6">
          <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
            <Lock className="size-5 text-primary" /> Password
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Change your portal password. You&apos;ll stay signed in here; other
            devices are signed out.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-11 rounded-full px-4"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 rounded-full px-4"
              />
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-5 h-11 rounded-full"
            onClick={changePassword}
            disabled={pwBusy || !currentPassword || !newPassword}
          >
            {pwBusy ? <Loader2 className="animate-spin" /> : <Lock className="size-4" />}
            Update password
          </Button>
        </CardContent>
      </Card>

      {/* Account (read-only) */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium">Signed in as</p>
          <p className="mt-1 text-sm text-muted-foreground">{profile.email}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Need your email changed? Message us in chat and we&apos;ll sort it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
