import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Input } from "../input";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(serious).toHaveLength(0);
}

describe("Input a11y", () => {
  it("has no critical/serious violations with associated label", async () => {
    const { container } = render(
      <div>
        <label htmlFor="test-input">Email</label>
        <Input id="test-input" type="email" />
      </div>
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("has no critical/serious violations with aria-label", async () => {
    const { container } = render(
      <Input aria-label="Search" type="search" />
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
