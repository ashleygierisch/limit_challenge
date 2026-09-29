/** Presentation helpers shared across the fleet views. */

import dayjs from 'dayjs';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** Money arrives from DRF as a decimal string, never a float. */
export function formatCurrency(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(amount) ? '-' : currency.format(amount);
}

/** Render an ISO date without letting the local timezone shift the day. */
export function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Today as `YYYY-MM-DD` in local time, for date input defaults and maxima. */
export function todayIso() {
  return dayjs().format('YYYY-MM-DD');
}

/** "Never serviced" / "412 days ago", for the overdue list. */
export function formatAge(days: number | null | undefined) {
  if (days === null || days === undefined) return 'Never serviced';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 365) return `${days} days ago`;
  const years = Math.floor(days / 365);
  const remainder = days % 365;
  const yearPart = years === 1 ? '1 year' : `${years} years`;
  return remainder < 30 ? `${yearPart} ago` : `${yearPart}, ${remainder} days ago`;
}
