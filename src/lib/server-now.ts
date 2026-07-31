/**
 * The current time, read once on the server per request.
 *
 * Components must not call Date.now() during render — the value would drift
 * between renders and React's purity rule (rightly) rejects it. Server pages
 * read it here and pass the number down, so anything derived from "now"
 * (aging buckets, "waiting N days") stays stable for that render.
 */
export function serverNow(): number {
  return Date.now();
}
