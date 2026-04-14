import { Html, Head, Body, Container, Text, Button, Hr } from "@react-email/components";

/**
 * Pure presentation component for the team-invite email.
 *
 * Per Phase 12 D-06: all strings arrive as pre-resolved, pre-interpolated
 * props from the email worker (packages/modules/billing/src/jobs/send-email.ts).
 * This component has no knowledge of @baseworks/i18n and no hooks.
 *
 * Visual layout (fontFamily, colors, spacing, Button styling) is byte-identical
 * to the pre-Phase-12 version — only the text content is now upstream-provided.
 */
interface TeamInviteEmailProps {
  inviteLink: string;
  heading: string;
  body: string;
  ctaLabel: string;
  footer: string;
}

export function TeamInviteEmail({
  inviteLink,
  heading,
  body,
  ctaLabel,
  footer,
}: TeamInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>
            {heading}
          </Text>
          <Text>
            {body}
          </Text>
          <Button
            href={inviteLink}
            style={{ backgroundColor: "#18181b", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", textDecoration: "none" }}
          >
            {ctaLabel}
          </Button>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>
            {footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
