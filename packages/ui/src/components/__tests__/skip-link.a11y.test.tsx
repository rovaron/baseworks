import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { SkipToContent } from "../skip-link";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(serious).toHaveLength(0);
}

describe("SkipToContent a11y", () => {
  it("has no critical/serious violations", async () => {
    const { container } = render(<SkipToContent label="Skip to content" />);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("renders an anchor with href pointing to main-content", () => {
    render(<SkipToContent label="Skip to content" />);
    const link = screen.getByText("Skip to content");
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("supports custom targetId", () => {
    render(<SkipToContent label="Skip to content" targetId="custom-target" />);
    const link = screen.getByText("Skip to content");
    expect(link).toHaveAttribute("href", "#custom-target");
  });

  it("renders the localized label passed in as a prop", () => {
    render(<SkipToContent label="Pular para o conteúdo" />);
    const link = screen.getByText("Pular para o conteúdo");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
  });
});
