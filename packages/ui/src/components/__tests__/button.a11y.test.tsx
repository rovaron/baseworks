import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Button } from "../button";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(serious).toHaveLength(0);
}

describe("Button a11y", () => {
  it("has no critical/serious violations with text content", async () => {
    const { container } = render(<Button>Click me</Button>);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("has no critical/serious violations with aria-label (icon-only)", async () => {
    const { container } = render(
      <Button aria-label="Close" size="icon">
        <span aria-hidden="true">X</span>
      </Button>
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("has no critical/serious violations when disabled", async () => {
    const { container } = render(<Button disabled>Disabled</Button>);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
