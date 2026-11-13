"use client";

import { useEffect } from "react";
import { timezoneMarker, timezoneMarkerKey, timezoneRecentlySent } from "@/lib/browser-timezone";

/**
 * Silently records the client's browser timezone, so the admin can see their
 * local time. Renders nothing, and costs the page no read: a marker in this
 * browser remembers the zone it sent for a day, and the route only fills an
 * empty zone, so a race can't overwrite a manual edit. A zone cleared since
 * is refilled by the next send.
 */
export function TimezoneSync({ userId }: { userId: string }) {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const key = timezoneMarkerKey(userId);
    try {
      if (timezoneRecentlySent(localStorage.getItem(key), tz, Date.now())) return;
    } catch {
      // Storage blocked: send it anyway; the route ignores a stored zone.
    }
    void fetch("/api/me/timezone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((res) => {
        if (!res.ok) return;
        try {
          localStorage.setItem(key, timezoneMarker(tz, Date.now()));
        } catch {
          // Nothing to remember it in; the next page load sends it again.
        }
      })
      .catch(() => {});
  }, [userId]);
  return null;
}
