import { render } from "@react-email/render";
import { requireAdmin } from "@/lib/dal/session";
import { renderMergeTags, renderMergeTagsInDoc } from "@/lib/merge-tags";
import { appUrl } from "@/lib/app-url";
import CampaignEmail from "@/emails/campaign";

/**
 * Renders the real campaign email so the composer can preview exactly what
 * ships, instead of a lookalike built from Tailwind classes. Sample merge
 * values stand in for a recipient.
 */
export async function POST(request: Request) {
  await requireAdmin();

  let payload: { subject?: string; body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const vars = {
    firstName: "Alex",
    name: "Alex Morgan",
    company: "Northwind Studio",
    email: "alex@example.com",
  };
  const subject = renderMergeTags(payload.subject ?? "", vars);
  const body = renderMergeTagsInDoc(payload.body ?? null, vars);

  const html = await render(
    <CampaignEmail
      subject={subject}
      body={body}
      unsubscribeUrl={`${appUrl()}/unsubscribe?token=preview`}
    />,
  );

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
