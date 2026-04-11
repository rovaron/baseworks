import { Html, Head, Body, Container, Text, Button, Hr } from "@react-email/components";

interface TeamInviteEmailProps {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
}

export function TeamInviteEmail({
  inviteLink,
  organizationName,
  inviterName,
  role,
}: TeamInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>
            You're invited to {organizationName}
          </Text>
          <Text>
            {inviterName} has invited you to join {organizationName} as a {role}.
          </Text>
          <Button
            href={inviteLink}
            style={{ backgroundColor: "#18181b", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", textDecoration: "none" }}
          >
            Accept Invitation
          </Button>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>
            If you were not expecting this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
