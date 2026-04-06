import { Html, Head, Body, Container, Text, Button, Hr } from "@react-email/components";

interface PasswordResetEmailProps {
  url: string;
  userName?: string;
}

export function PasswordResetEmail({ url, userName = "there" }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>Reset Your Password</Text>
          <Text>Hi {userName}, click the button below to reset your password. This link expires in 1 hour.</Text>
          <Button href={url} style={{ backgroundColor: "#18181b", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", textDecoration: "none" }}>Reset Password</Button>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>If you did not request this, you can ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}
