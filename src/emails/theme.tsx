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

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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
      <Body style={{ backgroundColor: brand.bg, fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: "520px", margin: "0 auto" }}>
          <Section style={{ backgroundColor: brand.navy, borderRadius: "12px 12px 0 0", padding: "20px 32px" }}>
            <Img
              src={`${appUrl}/avix-logo.png`}
              alt="Avix Digital"
              height="32"
              style={{ display: "block" }}
            />
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
          <Text style={{ color: brand.slate, fontSize: "12px", textAlign: "center", marginTop: "16px" }}>
            Avix Digital ·{" "}
            <Link href="https://avixdigital.com" style={{ color: brand.slate }}>
              avixdigital.com
            </Link>
          </Text>
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
