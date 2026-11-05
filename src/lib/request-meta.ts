import "server-only";
import { headers } from "next/headers";
import { clientAddress, keptChain } from "@/lib/forwarded-for";

/**
 * Who is on the other end of a public action, for the proposal audit trail
 * (views, declines, acceptances, signatures).
 *
 * The x-forwarded-for address is only as trustworthy as the proxies in front
 * of the app: if the host appends rather than overwrites the header, a
 * visitor can put anything at its start. TRUSTED_PROXY_HOPS, the number of
 * appending proxies, makes the address come from the end instead (see
 * clientAddress); check the header the host actually sends before setting
 * it. Record the address as supporting evidence, never as identity — which
 * is why the raw headers come back too, for a signature to keep beside the
 * address it settled on.
 */
export async function requestMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
  /** The x-forwarded-for chain as received, capped, keeping its end. */
  forwardedFor: string | null;
  /** x-real-ip as received, capped. */
  realIp: string | null;
}> {
  const h = await headers();
  const chain = h.get("x-forwarded-for");
  const realIp = h.get("x-real-ip")?.trim() || null;
  const userAgent = h.get("user-agent");
  return {
    ipAddress: clientAddress(chain, realIp, Number(process.env.TRUSTED_PROXY_HOPS) || 0),
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    forwardedFor: keptChain(chain),
    realIp: realIp ? realIp.slice(0, 64) : null,
  };
}
