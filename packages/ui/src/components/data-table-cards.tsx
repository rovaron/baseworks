"use client";

import * as React from "react";
import {
  type Table as ReactTable,
  type Row,
  flexRender,
} from "@tanstack/react-table";
import { ChevronDown, X } from "lucide-react";
import { Card, CardContent } from "./card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Badge } from "./badge";
import { cn } from "../lib/utils";

interface ColumnMeta {
  priority?: number;
  cardHidden?: boolean;
}

interface DataTableCardsProps<TData> {
  table: ReactTable<TData>;
  priorityCount?: number;
  onRowClick?: (row: TData) => void;
  renderActions?: (row: TData) => React.ReactNode;
  emptyMessage?: string;
}

function getColumnMeta(columnDef: { meta?: unknown }): ColumnMeta {
  return (columnDef.meta as ColumnMeta) ?? {};
}

function getHeaderString(header: unknown): string {
  if (typeof header === "string") return header;
  return "";
}

export function DataTableCards<TData>({
  table,
  priorityCount = 3,
  onRowClick,
  renderActions,
  emptyMessage = "No results.",
}: DataTableCardsProps<TData>) {
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null);

  const allColumns = table.getAllColumns();

  // Classify columns by priority
  const priorityColumns = allColumns
    .filter((col) => {
      const meta = getColumnMeta(col.columnDef);
      return (
        !meta.cardHidden &&
        meta.priority !== undefined &&
        meta.priority >= 1 &&
        meta.priority <= priorityCount
      );
    })
    .sort(
      (a, b) =>
        (getColumnMeta(a.columnDef).priority ?? 0) -
        (getColumnMeta(b.columnDef).priority ?? 0)
    );

  const detailColumns = allColumns.filter((col) => {
    const meta = getColumnMeta(col.columnDef);
    if (meta.cardHidden) return false;
    if (meta.priority === undefined) return true;
    return meta.priority > priorityCount;
  });

  // Sortable columns for dropdown
  const sortableColumns = allColumns.filter((col) => col.getCanSort());

  // Active column filters
  const columnFilters = table.getState().columnFilters;

  const handleCardClick = (rowId: string, rowData: TData) => {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
    onRowClick?.(rowData);
  };

  const rows = table.getRowModel().rows;

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort dropdown */}
      {sortableColumns.length > 0 && (
        <Select
          value={table.getState().sorting[0]?.id ?? ""}
          onValueChange={(value) => {
            const col = allColumns.find((c) => c.id === value);
            if (col) {
              col.toggleSorting();
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {sortableColumns.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {getHeaderString(col.columnDef.header)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Filter chips */}
      {columnFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {columnFilters.map((filter) => {
            const col = allColumns.find((c) => c.id === filter.id);
            const headerLabel = col
              ? getHeaderString(col.columnDef.header)
              : filter.id;
            return (
              <Badge key={filter.id} variant="secondary">
                {headerLabel}: {String(filter.value)}
                <button
                  type="button"
                  className="ml-1 inline-flex items-center"
                  onClick={() => col?.setFilterValue(undefined)}
                  aria-label={`Clear ${headerLabel} filter`}
                >
                  <X className="h-4 w-4" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Card list */}
      <div className="space-y-4">
        {rows.map((row) => {
          const isExpanded = expandedRowId === row.id;

          return (
            <Card
              key={row.id}
              data-card=""
              className="cursor-pointer"
              onClick={() => handleCardClick(row.id, row.original)}
            >
              <CardContent className="p-4">
                {/* Priority columns summary */}
                <div className="space-y-1">
                  {priorityColumns.map((col, idx) => {
                    const cell = row
                      .getVisibleCells()
                      .find((c) => c.column.id === col.id);
                    if (!cell) return null;

                    const meta = getColumnMeta(col.columnDef);

                    // Priority 1 fields render as title
                    if (meta.priority === 1) {
                      return (
                        <div key={col.id} className="text-sm font-semibold">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </div>
                      );
                    }

                    // Priority 2+ fields render as label: value
                    return (
                      <div key={col.id}>
                        <span className="text-xs text-muted-foreground">
                          {getHeaderString(col.columnDef.header)}:{" "}
                        </span>
                        <span className="text-sm">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Chevron indicator */}
                <div className="mt-2 flex justify-end">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                    aria-label={isExpanded ? "Hide details" : "Show details"}
                  />
                </div>

                {/* Expanded detail columns */}
                {isExpanded && (
                  <>
                    <div className="my-3 border-t" />
                    <div className="space-y-1">
                      {detailColumns.map((col) => {
                        const cell = row
                          .getVisibleCells()
                          .find((c) => c.column.id === col.id);
                        if (!cell) return null;

                        return (
                          <div key={col.id}>
                            <span className="text-xs text-muted-foreground">
                              {getHeaderString(col.columnDef.header)}:{" "}
                            </span>
                            <span className="text-sm">
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {renderActions && (
                        <div className="mt-2">
                          {renderActions(row.original)}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
