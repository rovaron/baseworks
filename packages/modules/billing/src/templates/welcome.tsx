import { Html, Head, Body, Container, Text, Hr } from "@react-email/components";

interface WelcomeEmailProps {
  userName?: string;
}

export function WelcomeEmail({ userName = "there" }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>Welcome to Baseworks!</Text>
          <Text>Hi {userName}, your account has been created successfully.</Text>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>You are receiving this because you signed up for Baseworks.</Text>
        </Container>
      </Body>
    </Html>
  );
}
