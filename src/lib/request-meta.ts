import "server-only";
import { headers } from "next/headers";

/**
 * Who is on the other end of a public action, for the proposal audit trail
 * (views, declines, acceptances).
 *
 * The first x-forwarded-for hop is only as trustworthy as the proxy in front
 * of the app: if the host appends rather than overwrites the header, a
 * visitor can put anything there. Record it as supporting evidence, never as
 * identity.
 */
export async function requestMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || null;
  const userAgent = h.get("user-agent");
  return {
    ipAddress: ip ? ip.slice(0, 64) : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
