import { Html, Head, Body, Container, Text, Hr } from "@react-email/components";

interface BillingNotificationEmailProps {
  event: string;
  message: string;
}

export function BillingNotificationEmail({ event, message }: BillingNotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>Billing Update</Text>
          <Text>{message}</Text>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>Event: {event}</Text>
        </Container>
      </Body>
    </Html>
  );
}
