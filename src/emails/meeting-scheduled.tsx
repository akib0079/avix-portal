import { Link, Text } from "@react-email/components";
import { EmailShell, EmailHeading, EmailBody, EmailButton, brand } from "./theme";

/**
 * Sent to the client when a meeting is booked (or cancelled). Times are
 * rendered in the CLIENT'S timezone by the caller.
 */
export default function MeetingScheduledEmail({
  firstName,
  title,
  whenText,
  timezoneLabel,
  durationMins,
  meetingUrl,
  notes,
  googleUrl,
  icsUrl,
  cancelled = false,
}: {
  firstName: string;
  title: string;
  /** Already formatted in the client's timezone. */
  whenText: string;
  timezoneLabel: string;
  durationMins: number;
  meetingUrl: string | null;
  notes: string | null;
  googleUrl: string;
  icsUrl: string;
  cancelled?: boolean;
}) {
  return (
    <EmailShell
      preview={
        cancelled ? `Cancelled: ${title}` : `Meeting booked: ${title} — ${whenText}`
      }
    >
      <EmailHeading>
        {cancelled ? "Meeting cancelled" : "You have a meeting booked 📅"}
      </EmailHeading>
      <EmailBody>
        Hi {firstName},{" "}
        {cancelled
          ? "the following meeting has been cancelled:"
          : "Avix Digital has scheduled a meeting with you:"}
      </EmailBody>

      <div
        style={{
          border: `1px solid ${brand.border}`,
          borderRadius: "8px",
          margin: "0 0 16px",
          padding: "14px 18px",
        }}
      >
        <Text style={{ color: brand.navy, fontSize: "15px", fontWeight: 700, margin: "0 0 4px" }}>
          {title}
        </Text>
        <Text style={{ color: "#334155", fontSize: "14px", margin: "0 0 2px" }}>
          {whenText}{" "}
          <span style={{ color: brand.slate }}>({timezoneLabel})</span>
        </Text>
        <Text style={{ color: brand.slate, fontSize: "13px", margin: 0 }}>
          {durationMins} minutes
        </Text>
        {notes && (
          <Text style={{ color: "#334155", fontSize: "13px", margin: "8px 0 0" }}>
            {notes}
          </Text>
        )}
      </div>

      {!cancelled && meetingUrl && (
        <EmailButton href={meetingUrl}>Join the meeting</EmailButton>
      )}

      {!cancelled && (
        <Text style={{ fontSize: "13px", textAlign: "center", margin: "8px 0 0" }}>
          <Link href={googleUrl} style={{ color: brand.orange, fontWeight: 600 }}>
            Add to Google Calendar
          </Link>
          <span style={{ color: brand.border }}> &nbsp;·&nbsp; </span>
          <Link href={icsUrl} style={{ color: brand.orange, fontWeight: 600 }}>
            Download .ics (Apple/Outlook)
          </Link>
        </Text>
      )}
    </EmailShell>
  );
}
