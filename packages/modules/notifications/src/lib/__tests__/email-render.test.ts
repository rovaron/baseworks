import { describe, expect, test } from "bun:test";
import { renderEmail } from "../email-render";

describe("renderEmail", () => {
  test("renders password-reset with non-empty html + fixed subject", async () => {
    const { html, subject } = await renderEmail("password-reset", {
      url: "https://example.com/reset",
      userName: "Ada",
    });
    expect(html.length).toBeGreaterThan(0);
    expect(subject).toBe("Reset Your Password");
  });

  test("resolves a localized subject for team-invite", async () => {
    const { html, subject } = await renderEmail("team-invite", {
      inviteLink: "https://example.com/invite",
      organizationName: "Acme",
      inviterName: "Grace",
      role: "member",
    });
    expect(html.length).toBeGreaterThan(0);
    expect(typeof subject).toBe("string");
    expect(subject.length).toBeGreaterThan(0);
  });

  test("throws on unknown template", async () => {
    await expect(renderEmail("does-not-exist", {})).rejects.toThrow(/Unknown email template/);
  });
});
