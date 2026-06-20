import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../sheet";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(serious).toHaveLength(0);
}

describe("Sheet a11y", () => {
  it("has no critical/serious violations when open with title", async () => {
    const { container } = render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Test Sheet</SheetTitle>
            <SheetDescription>This is a test sheet</SheetDescription>
          </SheetHeader>
          <p>Sheet body content</p>
        </SheetContent>
      </Sheet>,
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
