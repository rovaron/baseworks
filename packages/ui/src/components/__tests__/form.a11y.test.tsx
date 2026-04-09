import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "../form";
import { Input } from "../input";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(serious).toHaveLength(0);
}

function TestForm({ error }: { error?: string }) {
  const form = useForm({
    defaultValues: { name: "" },
  });

  React.useEffect(() => {
    if (error) {
      form.setError("name", { type: "manual", message: error });
    }
  }, [error, form]);

  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter your name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe("Form a11y", () => {
  it("has no critical/serious violations with label and control", async () => {
    const { container } = render(<TestForm />);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("has no critical/serious violations with error message", async () => {
    const { container } = render(<TestForm error="Name is required" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("renders error message with role=alert", async () => {
    render(<TestForm error="Name is required" />);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("Name is required");
    });
  });
});
