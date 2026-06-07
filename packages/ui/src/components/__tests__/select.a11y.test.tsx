import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(serious).toHaveLength(0);
}

describe("Select a11y", () => {
  it("has no critical/serious violations with trigger and label", async () => {
    const { container } = render(
      <div>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: control is associated via aria-labelledby on SelectTrigger below — this test asserts exactly that pattern */}
        <label id="select-label">Choose option</label>
        <Select>
          <SelectTrigger aria-labelledby="select-label">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">Option One</SelectItem>
            <SelectItem value="two">Option Two</SelectItem>
          </SelectContent>
        </Select>
      </div>,
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
