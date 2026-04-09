import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../select";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(serious).toHaveLength(0);
}

describe("Select a11y", () => {
  it("has no critical/serious violations with trigger and label", async () => {
    const { container } = render(
      <div>
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
      </div>
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
