'use client';

/**
 * A date input backed by the MUI calendar picker.
 *
 * The rest of the app -- query params, API payloads -- speaks ISO `YYYY-MM-DD`
 * strings, so this converts at the boundary and never lets a Dayjs object leak
 * outward. `dayjs(iso)` and `.format('YYYY-MM-DD')` both work in local time, so
 * a date cannot shift by a day the way `new Date(iso)` would.
 *
 * Replaces `<TextField type="date">`, whose native control differs per browser,
 * cannot be cleared consistently, and ignores the theme.
 */

import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';

interface DateFieldProps {
  label: string;
  /** ISO `YYYY-MM-DD`, or '' for empty. */
  value: string;
  /** Receives ISO `YYYY-MM-DD`, or '' when cleared. */
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  helperText?: string;
  error?: boolean;
  required?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  /** Show a clear button in the field. */
  clearable?: boolean;
}

function toDayjs(value?: string): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

export function DateField({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  helperText = ' ',
  error = false,
  required = false,
  size = 'small',
  fullWidth = true,
  clearable = true,
}: DateFieldProps) {
  return (
    <DatePicker
      label={label}
      value={toDayjs(value)}
      onChange={(next) => onChange(next && next.isValid() ? next.format('YYYY-MM-DD') : '')}
      minDate={toDayjs(minDate) ?? undefined}
      maxDate={toDayjs(maxDate) ?? undefined}
      format="DD MMM YYYY"
      slotProps={{
        textField: { size, fullWidth, required, error, helperText },
        // Clearing has to be possible: an optional filter the user cannot
        // remove is worse than no filter at all.
        field: { clearable },
        // Jump straight to the month being constrained rather than today.
        popper: { placement: 'bottom-start' },
      }}
    />
  );
}
