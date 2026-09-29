'use client';

/**
 * Remembers which list a detail page was opened from, so leaving it returns to
 * that list exactly as it was — filters, sort and page intact.
 *
 * Why not just link back to `/`: the list's state lives entirely in its query
 * string, so a bare `/` is a different view. And why not `router.back()`:
 * a detail page reached from a shared link or a new tab has no history entry to
 * return to, and `back()` would then leave the app altogether.
 *
 * sessionStorage rather than a query parameter on the detail URL, so the
 * detail link stays clean and shareable. It is per-tab and cleared when the tab
 * closes, which matches the lifetime of "where I came from". Every access is
 * guarded: storage throws in some privacy modes, and the app must still work
 * with the plain fallback.
 */

import { useMemo, useSyncExternalStore } from 'react';

const KEY = 'fleet:return-to';

export interface ReturnTo {
  url: string;
  label: string;
}

export const DEFAULT_RETURN: ReturnTo = { url: '/', label: 'Vehicles' };

/** Record the list being left. Call this immediately before navigating. */
export function rememberReturnTo(label: string) {
  if (typeof window === 'undefined') return;
  try {
    const url = `${window.location.pathname}${window.location.search}`;
    window.sessionStorage.setItem(KEY, JSON.stringify({ url, label }));
  } catch {
    // Storage unavailable; the detail page falls back to the plain list.
  }
}

function read(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** No-op: the value cannot change while a detail page is mounted. */
function subscribe() {
  return () => {};
}

function serverSnapshot(): string | null {
  return null;
}

function parse(raw: string | null): ReturnTo {
  if (!raw) return DEFAULT_RETURN;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_RETURN;

    const { url, label } = parsed as Record<string, unknown>;
    // Only same-origin relative paths. A stored value that began with `//` or a
    // scheme would turn this link into an off-site redirect.
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
      return DEFAULT_RETURN;
    }
    return {
      url,
      label: typeof label === 'string' && label ? label : DEFAULT_RETURN.label,
    };
  } catch {
    return DEFAULT_RETURN;
  }
}

/**
 * The list to return to.
 *
 * Read through `useSyncExternalStore` so the server and the first client render
 * agree (both see the default) and the stored value is picked up without an
 * effect that sets state. `getSnapshot` returns the raw string, which is stable
 * between calls; parsing happens in a memo so a fresh object is not returned on
 * every render.
 */
export function useReturnTo(): ReturnTo {
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  return useMemo(() => parse(raw), [raw]);
}
