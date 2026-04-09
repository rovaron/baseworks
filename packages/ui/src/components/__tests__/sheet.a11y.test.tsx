import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../sheet";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
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
      </Sheet>
    );
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });
});
