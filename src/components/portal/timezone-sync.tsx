"use client";

import { useEffect } from "react";
import { syncMyTimezone } from "@/lib/actions/timezone";

/**
 * Silently records the client's browser timezone once, so the admin can see
 * their local time. Renders nothing; only fires when none is stored yet
 * (the server action also guards, so a race can't overwrite a manual edit).
 */
export function TimezoneSync({ hasTimezone }: { hasTimezone: boolean }) {
  useEffect(() => {
    if (hasTimezone) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) void syncMyTimezone(tz);
  }, [hasTimezone]);
  return null;
}
