'use client';

/**
 * Vehicle search filters, stored in the URL rather than in component state.
 *
 * The URL is the single source of truth, which is what makes a filtered view
 * shareable, reloadable and reachable with the back button. Text inputs keep a
 * short-lived local draft so typing stays responsive, and push to the URL on a
 * debounce.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { nextSortState, type SortState } from './sorting';
import type { VehicleFilters } from './types';

export const EMPTY_FILTERS: VehicleFilters = {
  office: '',
  active: '',
  make: '',
  model: '',
  maintained_from: '',
  maintained_to: '',
  certification_number: '',
};

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as Array<keyof VehicleFilters>;

/** Filters typed into a text box, debounced before they reach the URL. */
const DEBOUNCED_KEYS: Array<keyof VehicleFilters> = ['make', 'model', 'certification_number'];

const DEBOUNCE_MS = 350;

type Drafts = Partial<VehicleFilters>;

export function useVehicleFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /** Identity of the current URL, used to decide whether drafts are stale. */
  const urlKey = searchParams.toString();

  const urlFilters = useMemo(() => {
    const next = { ...EMPTY_FILTERS };
    for (const key of FILTER_KEYS) {
      next[key] = searchParams.get(key) ?? '';
    }
    return next;
  }, [searchParams]);

  const page = Number(searchParams.get('page') ?? '1') || 1;

  const sort: SortState = useMemo(() => {
    const key = searchParams.get('sort');
    if (!key) return null;
    return { key, direction: searchParams.get('dir') === 'desc' ? 'desc' : 'asc' };
  }, [searchParams]);

  // Drafts are tagged with the URL they were typed against. Comparing that tag
  // during render discards them when the URL moves on -- back button, reset, or
  // the debounce landing -- without an effect that calls setState.
  const [draftState, setDraftState] = useState<{ key: string; drafts: Drafts }>({
    key: urlKey,
    drafts: {},
  });
  const drafts = useMemo(
    () => (draftState.key === urlKey ? draftState.drafts : {}),
    [draftState, urlKey],
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const pushToUrl = useCallback(
    (next: VehicleFilters, nextPage: number, nextSort: SortState) => {
      const params = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        if (next[key]) params.set(key, next[key]);
      }
      // Page 1 and unsorted are the defaults, so they stay out of the URL.
      if (nextPage > 1) params.set('page', String(nextPage));
      if (nextSort) {
        params.set('sort', nextSort.key);
        if (nextSort.direction === 'desc') params.set('dir', 'desc');
      }

      const query = params.toString();
      router.replace(query ? `/?${query}` : '/', { scroll: false });
    },
    [router],
  );

  const setFilter = useCallback(
    (key: keyof VehicleFilters, value: string) => {
      const merged = { ...urlFilters, ...drafts, [key]: value };

      // Any filter change invalidates the current page number: page 4 of the
      // old result set is meaningless against the new one.
      if (!DEBOUNCED_KEYS.includes(key)) {
        if (timer.current) clearTimeout(timer.current);
        pushToUrl(merged, 1, sort);
        return;
      }

      setDraftState({ key: urlKey, drafts: { ...drafts, [key]: value } });

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => pushToUrl(merged, 1, sort), DEBOUNCE_MS);
    },
    [drafts, pushToUrl, sort, urlFilters, urlKey],
  );

  const setPage = useCallback(
    (nextPage: number) => pushToUrl(urlFilters, nextPage, sort),
    [pushToUrl, sort, urlFilters],
  );

  const toggleSort = useCallback(
    (key: string) => {
      // Back to page 1: row 40 of the old order is not row 40 of the new one.
      pushToUrl(urlFilters, 1, nextSortState(sort, key));
    },
    [pushToUrl, sort, urlFilters],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    router.replace('/', { scroll: false });
  }, [router]);

  /** What the inputs display: the draft if one exists, otherwise the URL. */
  const values = useMemo(
    () => ({ ...urlFilters, ...drafts }) as VehicleFilters,
    [drafts, urlFilters],
  );

  const activeCount = FILTER_KEYS.filter((key) => urlFilters[key] !== '').length;

  return {
    /** Committed filters -- what the query is keyed on and sent with. */
    filters: urlFilters,
    /** Display values, including not-yet-committed keystrokes. */
    values,
    page,
    sort,
    activeCount,
    setFilter,
    setPage,
    toggleSort,
    reset,
  };
}
