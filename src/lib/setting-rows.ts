/**
 * AppSetting keys, and the pure mappers from their rows to values, for the
 * booking config and the Google Calendar status. Dependency-free so the
 * settings page can read every key it needs in one statement and map the rows
 * itself, and so the mappers can be tested.
 */

type SettingRow = { key: string; value: string };

export const AGENCY_TZ_KEY = "agencyTimezone";
export const SLOT_MIN_KEY = "bookingSlotMinutes";
export const BOOKING_URL_KEY = "bookingLocationUrl";
export const BOOKING_KEYS = [AGENCY_TZ_KEY, SLOT_MIN_KEY, BOOKING_URL_KEY] as const;

const DEFAULT_TZ = "America/New_York";
const DEFAULT_SLOT = 30;

export type BookingConfig = {
  agencyTimezone: string;
  slotMinutes: number;
  bookingUrl: string | null;
};

/** The booking config from its setting rows; other keys are ignored. */
export function bookingConfigFrom(rows: readonly SettingRow[]): BookingConfig {
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const slot = Number(map[SLOT_MIN_KEY]);
  return {
    agencyTimezone: map[AGENCY_TZ_KEY] || DEFAULT_TZ,
    slotMinutes: Number.isFinite(slot) && slot > 0 ? slot : DEFAULT_SLOT,
    bookingUrl: map[BOOKING_URL_KEY] || null,
  };
}

export const GCAL_REFRESH_KEY = "googleCalRefreshToken";
export const GCAL_ID_KEY = "googleCalId";
export const GCAL_EMAIL_KEY = "googleCalEmail";
export const GCAL_KEYS = [GCAL_REFRESH_KEY, GCAL_ID_KEY, GCAL_EMAIL_KEY] as const;

export type CalendarStatus = { connected: boolean; email: string | null; calendarId: string };

/**
 * Whether a calendar is connected, from its setting rows. Never returns the
 * refresh token itself: only whether one is stored.
 */
export function calendarStatusFrom(rows: readonly SettingRow[]): CalendarStatus {
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    connected: !!map[GCAL_REFRESH_KEY],
    email: map[GCAL_EMAIL_KEY] || null,
    calendarId: map[GCAL_ID_KEY] || "primary",
  };
}
