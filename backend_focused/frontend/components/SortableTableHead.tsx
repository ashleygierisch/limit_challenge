'use client';

/**
 * Table header with sortable columns.
 *
 * Presentational and mode-agnostic: it renders the arrow and reports clicks,
 * and the page decides whether that means a re-query or an in-memory re-sort.
 * Columns opt out with `sortable: false` — used for Actions, which holds
 * buttons rather than a value.
 */

import { TableCell, TableHead, TableRow, TableSortLabel, Tooltip } from '@mui/material';
import type { ReactNode } from 'react';

import type { SortState } from '@/lib/sorting';

export interface SortableColumn {
  /** Stable identifier, used as the sort key. */
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  /** Defaults to true; set false for columns with no orderable value. */
  sortable?: boolean;
}

interface SortableTableHeadProps {
  columns: SortableColumn[];
  sort: SortState;
  onSort: (key: string) => void;
}

export function SortableTableHead({ columns, sort, onSort }: SortableTableHeadProps) {
  return (
    <TableHead>
      <TableRow>
        {columns.map((column) => {
          const sortable = column.sortable !== false;
          const active = sort?.key === column.key;

          const cell = (
            <TableCell
              key={column.key}
              align={column.align}
              sx={{ width: column.width }}
              // Announces the sorted column to screen readers.
              sortDirection={active ? sort.direction : false}
            >
              {sortable ? (
                <TableSortLabel
                  active={active}
                  direction={active ? sort.direction : 'asc'}
                  onClick={() => onSort(column.key)}
                >
                  {column.label}
                </TableSortLabel>
              ) : (
                column.label
              )}
            </TableCell>
          );

          if (!sortable) return cell;

          const hint = active
            ? sort.direction === 'asc'
              ? 'Sorted ascending — click for descending'
              : 'Sorted descending — click to clear'
            : 'Click to sort';

          return (
            <Tooltip key={column.key} title={hint} enterDelay={600}>
              {cell}
            </Tooltip>
          );
        })}
      </TableRow>
    </TableHead>
  );
}
