'use client';

/** An option for a MUI `TextField select`. */
export interface Option {
  value: string;
  label: string;
}

/**
 * Guarantee the list contains an option for `current`.
 *
 * A Select whose value matches none of its items renders blank and warns. That
 * happens whenever a value arrives before the list it selects from has loaded —
 * from a shared URL, or an edit form seeded with an id. Returns the options
 * unchanged when `current` is empty or already present; otherwise prepends a
 * stand-in, so the value stays valid and the filter does not look unset.
 */
export function withCurrentValue(
  options: Option[],
  current: string,
  fallbackLabel: string,
): Option[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: fallbackLabel }, ...options];
}
