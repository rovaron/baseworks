import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
  getSortingRowModel,
  getFilteredRowModel,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import * as React from "react";
import { DataTableCards } from "../data-table-cards";

type MockRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
};

const mockData: MockRow[] = [
  {
    id: "1",
    name: "Alice",
    email: "alice@test.com",
    status: "active",
    createdAt: "2024-01-01",
  },
  {
    id: "2",
    name: "Bob",
    email: "bob@test.com",
    status: "banned",
    createdAt: "2024-02-01",
  },
];

const mockColumns: ColumnDef<MockRow, any>[] = [
  {
    accessorKey: "name",
    header: "Name",
    enableSorting: true,
    meta: { priority: 1 },
  },
  {
    accessorKey: "email",
    header: "Email",
    meta: { priority: 2 },
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { priority: 1 },
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    meta: { priority: 3 },
  },
  {
    id: "actions",
    header: "",
    cell: () => <button>Edit</button>,
    meta: { cardHidden: true },
  },
];

function TestWrapper({
  columns = mockColumns,
  data = mockData,
  priorityCount = 2,
  columnFilters,
}: {
  columns?: ColumnDef<MockRow, any>[];
  data?: MockRow[];
  priorityCount?: number;
  columnFilters?: ColumnFiltersState;
}) {
  const [filters, setFilters] = React.useState<ColumnFiltersState>(
    columnFilters ?? []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortingRowModel: getSortingRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      columnFilters: filters,
    },
    onColumnFiltersChange: setFilters,
  });

  return <DataTableCards table={table} priorityCount={priorityCount} />;
}

describe("DataTableCards", () => {
  it("renders priority columns in card summary", () => {
    render(<TestWrapper priorityCount={2} />);

    // Priority 1 and 2 columns should be visible: name, email, status
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();

    // cardHidden column (actions) should NOT render
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("hides detail columns when collapsed", () => {
    render(<TestWrapper priorityCount={2} />);

    // Priority 3 (createdAt) should not be visible in collapsed state
    expect(screen.queryByText("2024-01-01")).not.toBeInTheDocument();
    expect(screen.queryByText("2024-02-01")).not.toBeInTheDocument();
  });

  it("expands card on click to show detail columns", () => {
    render(<TestWrapper priorityCount={2} />);

    // Detail columns not visible initially
    expect(screen.queryByText("2024-01-01")).not.toBeInTheDocument();

    // Click the first card to expand
    const firstCard = screen.getByText("Alice").closest("[data-card]");
    expect(firstCard).toBeTruthy();
    fireEvent.click(firstCard!);

    // Now detail column should be visible
    expect(screen.getByText("2024-01-01")).toBeInTheDocument();

    // Second card's detail should still be hidden
    expect(screen.queryByText("2024-02-01")).not.toBeInTheDocument();
  });

  it("renders sort dropdown with sortable columns", () => {
    render(<TestWrapper />);

    // Sort dropdown should exist
    const sortTrigger = screen.getByText("Sort by");
    expect(sortTrigger).toBeInTheDocument();
  });

  it("renders filter chips for active column filters", () => {
    render(
      <TestWrapper
        columnFilters={[{ id: "status", value: "active" }]}
      />
    );

    // Filter chip should show column name and value
    expect(screen.getByText(/status/i)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });
});
