import "server-only";
import { headers } from "next/headers";

/** An IPv4 or IPv6 address, roughly: anything else in the header is not one. */
const IP_LIKE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Who is on the other end of a public action, for the proposal audit trail
 * (views, declines, acceptances, signatures).
 *
 * The first x-forwarded-for hop is only as trustworthy as the proxy in front
 * of the app: if the host appends rather than overwrites the header, a
 * visitor can put anything there. Record it as supporting evidence, never as
 * identity — which is why the raw headers come back too, for a signature to
 * keep beside the address it settled on.
 */
export async function requestMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
  /** The x-forwarded-for chain as received, capped. */
  forwardedFor: string | null;
  /** x-real-ip as received, capped. */
  realIp: string | null;
}> {
  const h = await headers();
  const chain = h.get("x-forwarded-for");
  const realIp = h.get("x-real-ip")?.trim() || null;
  const ip = chain?.split(",")[0]?.trim() || realIp;
  const userAgent = h.get("user-agent");
  return {
    ipAddress: ip && IP_LIKE.test(ip) ? ip : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    forwardedFor: chain ? chain.slice(0, 512) : null,
    realIp: realIp ? realIp.slice(0, 64) : null,
  };
}
