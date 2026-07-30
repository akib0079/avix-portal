import { applyUnsubscribe } from "@/lib/unsubscribe";

/**
 * One-click unsubscribe (RFC 8058). Mail clients POST here from the
 * List-Unsubscribe-Post header — no confirmation screen, no session. POST only,
 * so scanners and prefetchers that follow links can't opt anyone out.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  const ok = await applyUnsubscribe(token);
  return new Response(ok ? "Unsubscribed" : "Invalid token", {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
