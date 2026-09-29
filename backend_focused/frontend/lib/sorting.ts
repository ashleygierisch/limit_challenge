'use client';

/**
 * Shared sorting primitives for the list tables.
 *
 * Two modes, because the tables differ in a way that matters:
 *
 * - **Paginated** tables (vehicles, needs-service) sort in the database. The
 *   client holds ten of ninety rows, so sorting locally would reorder only the
 *   current page and quietly show the wrong rows. Those pages send `?ordering=`
 *   and use `SortState` purely to render the header arrow.
 * - **Unpaginated** reports (offices, mechanics, a vehicle's history) already
 *   hold every row, so they sort in memory with `useClientSort` and cost no
 *   extra request.
 *
 * Comparison is driven by the column's declared type rather than by inspecting
 * values: money and counts arrive as strings and would otherwise compare
 * lexicographically ("9" after "10"), and dates need chronological rather than
 * alphabetical order.
 */

import { useCallback, useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export type SortState = { key: string; direction: SortDirection } | null;

/** How a column's values should be compared. */
export type SortType = 'text' | 'number' | 'date' | 'boolean';

export type SortValue = string | number | boolean | null | undefined;

/**
 * Compare two values of a declared type.
 *
 * Empty values always sort lowest, which mirrors the API's explicit
 * `nulls_first` on ascending order — so "never serviced" leads when sorting by
 * last service in both the client-side and server-side tables.
 */
export function compareValues(a: SortValue, b: SortValue, type: SortType): number {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return -1;
  if (bMissing) return 1;

  switch (type) {
    case 'number': {
      const left = typeof a === 'number' ? a : Number(a);
      const right = typeof b === 'number' ? b : Number(b);
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return String(a).localeCompare(String(b));
      }
      return left - right;
    }
    case 'boolean':
      return Number(Boolean(a)) - Number(Boolean(b));
    case 'date':
      // ISO `YYYY-MM-DD` is chronological when compared as text.
      return String(a).localeCompare(String(b));
    case 'text':
    default:
      // `numeric` so PLATE-2 precedes PLATE-10 rather than following it, and
      // `base` sensitivity so case does not create a separate ordering.
      return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
  }
}

/** Per-column accessor and type, for in-memory sorting. */
export type SortAccessors<Row> = Record<string, { type: SortType; value: (row: Row) => SortValue }>;

/**
 * Toggle a sort key through ascending -> descending -> unsorted.
 *
 * Returning to unsorted matters: each report has a meaningful default order
 * (busiest mechanic first, most overdue vehicle first) that the user should be
 * able to get back to without reloading.
 */
export function nextSortState(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/** Sort rows held entirely in memory. */
export function useClientSort<Row>(
  rows: Row[],
  accessors: SortAccessors<Row>,
  initial: SortState = null,
) {
  const [sort, setSort] = useState<SortState>(initial);

  const toggle = useCallback(
    (key: string) => setSort((current) => nextSortState(current, key)),
    [],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    // Copy first: Array.prototype.sort mutates, and these arrays come straight
    // from the react-query cache.
    return [...rows].sort(
      (a, b) => factor * compareValues(accessor.value(a), accessor.value(b), accessor.type),
    );
  }, [accessors, rows, sort]);

  return { sorted, sort, toggle };
}

/**
 * Build an `?ordering=` value from a sort state and a column's field mapping.
 *
 * `invert` is for a column whose display runs opposite to its underlying field:
 * "Overdue by" ascending means the *oldest* service date first.
 */
export function toOrderingParam(
  sort: SortState,
  fields: Record<string, { fields: string[]; invert?: boolean }>,
): string {
  if (!sort) return '';
  const column = fields[sort.key];
  if (!column) return '';

  const descending = column.invert ? sort.direction === 'asc' : sort.direction === 'desc';
  return column.fields.map((field) => (descending ? `-${field}` : field)).join(',');
}
