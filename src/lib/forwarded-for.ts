/** An IPv4 or IPv6 address, roughly: anything else in the header is not one. */
const IP_LIKE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The caller's address from an x-forwarded-for chain, read with requestMeta's
 * rules but without the request, so it can be tested.
 *
 * Proxies that append write at the END of the chain; whatever comes before
 * is what the caller sent. With `trustedHops` appending proxies in front of
 * the app (TRUSTED_PROXY_HOPS), the address the outermost one saw is the one
 * `trustedHops` from the end, and nothing the caller puts in the header can
 * move it. Without a count (0, the default) the first entry is taken, which
 * is only right behind a proxy that overwrites the header.
 */
export function clientAddress(
  chain: string | null,
  realIp: string | null,
  trustedHops: number,
): string | null {
  const parts = (chain ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hops = Number.isInteger(trustedHops) && trustedHops > 0 ? trustedHops : 0;
  const ip = (hops > 0 && parts.length >= hops ? parts[parts.length - hops] : parts[0]) || realIp;
  return ip && IP_LIKE.test(ip) ? ip : null;
}

/** The chain as kept beside a signature: its end, where the proxies write, capped. */
export function keptChain(chain: string | null): string | null {
  return chain ? chain.slice(-512) : null;
}
