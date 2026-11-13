/**
 * Whether this process runs on a developer's computer rather than the
 * production host. The host is Linux (Hostinger Cloud); the app is developed
 * on macOS (and Windows would be no different).
 *
 * Decided by the OS, not by env, on purpose. The host's panel env is the
 * stale-prone store that ~/portal-secrets.env exists to override, and a local
 * .env can hold any app URL (an https tunnel to try the app on a phone, or
 * none at all), but neither can change the platform.
 */
export function isDeveloperPlatform(platform: string = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}
