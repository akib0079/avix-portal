import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export const brand = {
  orange: "#F65D0B",
  navy: "#0F172A",
  slate: "#64748B",
  border: "#E2E8F0",
  bg: "#F8FAFC",
};

/** White wordmark that stays visible on the dark navy header. */
const LOGO_URL =
  "https://avixdigital.com/wp-content/uploads/2026/05/Untitled-design244.png";

const SOCIALS: { label: string; href: string }[] = [
  { label: "Fiverr", href: "https://www.fiverr.com/s/o85mG6x" },
  { label: "Upwork", href: "https://www.upwork.com/freelancers/akibzawayed" },
  { label: "Facebook", href: "https://www.facebook.com/share/17oaLGqFHH/?mibextid=wwXIfr" },
  { label: "Instagram", href: "https://www.instagram.com/avixdigital_agency/" },
];

export function EmailShell({
  preview,
  children,
}: {
  preview: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: brand.bg, fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "32px 0" }}>
        <Container style={{ maxWidth: "520px", margin: "0 auto", padding: "0 12px" }}>
          <Section
            style={{
              backgroundColor: brand.navy,
              borderRadius: "12px 12px 0 0",
              padding: "24px 32px",
              textAlign: "center" as const,
            }}
          >
            <Link href="https://avixdigital.com">
              <Img
                src={LOGO_URL}
                alt="Avix Digital"
                height="36"
                style={{ display: "inline-block" }}
              />
            </Link>
          </Section>
          <Section
            style={{
              backgroundColor: "#ffffff",
              border: `1px solid ${brand.border}`,
              borderTop: "none",
              borderRadius: "0 0 12px 12px",
              padding: "32px",
            }}
          >
            {children}
          </Section>

          <Section style={{ padding: "20px 8px 0", textAlign: "center" as const }}>
            <Text style={{ color: brand.navy, fontSize: "13px", fontWeight: 700, margin: "0 0 2px" }}>
              Avix Digital
            </Text>
            <Text style={{ color: brand.slate, fontSize: "12px", margin: "0 0 10px" }}>
              Web development &amp; design that moves your business forward.
            </Text>
            <Text style={{ fontSize: "12px", margin: "0 0 10px" }}>
              {SOCIALS.map((s, i) => (
                <span key={s.label}>
                  {i > 0 && <span style={{ color: brand.border }}>&nbsp;·&nbsp;</span>}
                  <Link
                    href={s.href}
                    style={{ color: brand.orange, fontWeight: 600, textDecoration: "none" }}
                  >
                    {s.label}
                  </Link>
                </span>
              ))}
            </Text>
            <Text style={{ color: brand.slate, fontSize: "12px", margin: 0 }}>
              <Link href="https://avixdigital.com" style={{ color: brand.slate }}>
                avixdigital.com
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: brand.navy, fontSize: "20px", fontWeight: 700, margin: "0 0 12px" }}>
      {children}
    </Text>
  );
}

export function EmailBody({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "22px", margin: "0 0 12px" }}>
      {children}
    </Text>
  );
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ textAlign: "center", margin: "24px 0 12px" }}>
      <Link
        href={href}
        style={{
          backgroundColor: brand.orange,
          borderRadius: "8px",
          color: "#ffffff",
          display: "inline-block",
          fontSize: "14px",
          fontWeight: 600,
          padding: "12px 28px",
          textDecoration: "none",
        }}
      >
        {children}
      </Link>
    </Section>
  );
}
