'use client';

import { useEffect, useState } from 'react';

/**
 * A value that settles `delay` ms after it stops changing.
 *
 * For inputs whose every keystroke would otherwise reach the network. The
 * vehicle search debounces in `useVehicleFilters` for the same reason; this is
 * the same idea where the value feeds a query key rather than the URL.
 */
export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);

  return settled;
}
