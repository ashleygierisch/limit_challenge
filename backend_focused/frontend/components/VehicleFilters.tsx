'use client';

/**
 * The vehicle search panel.
 *
 * Every control writes to the URL (see `useVehicleFilters`), so a filtered view
 * is a shareable link and the back button steps through filter history.
 */

import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';

import { useMemo } from 'react';

import { todayIso } from '@/lib/format';
import { withCurrentValue } from '@/lib/select-options';
import { DateField } from './DateField';
import type { Mechanic, Office, VehicleFilters as Filters } from '@/lib/types';

interface VehicleFiltersProps {
  values: Filters;
  activeCount: number;
  offices: Office[];
  mechanics: Mechanic[];
  officesLoading: boolean;
  resultCount?: number;
  onChange: (key: keyof Filters, value: string) => void;
  onReset: () => void;
}

export function VehicleFilters({
  values,
  activeCount,
  offices,
  mechanics,
  officesLoading,
  resultCount,
  onChange,
  onReset,
}: VehicleFiltersProps) {
  const field = {
    size: 'small' as const,
    fullWidth: true,
  };

  // Values can arrive from the URL before these lists have loaded; see
  // withCurrentValue.
  const officeOptions = useMemo(
    () =>
      withCurrentValue(
        offices.map((office) => ({ value: String(office.id), label: office.name })),
        values.office,
        officesLoading ? 'Loading…' : `Office #${values.office}`,
      ),
    [offices, officesLoading, values.office],
  );

  const mechanicOptions = useMemo(
    () =>
      withCurrentValue(
        mechanics.map((mechanic) => ({
          value: mechanic.certification_number,
          label: `${mechanic.name} · ${mechanic.certification_number}`,
        })),
        values.certification_number,
        values.certification_number,
      ),
    [mechanics, values.certification_number],
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
        gap={1}
        flexWrap="wrap"
      >
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="subtitle2">Filters</Typography>
          {activeCount > 0 ? (
            <Chip size="small" color="primary" label={`${activeCount} active`} />
          ) : null}
          {resultCount !== undefined ? (
            <Typography variant="body2" color="text.secondary">
              {resultCount} {resultCount === 1 ? 'vehicle' : 'vehicles'}
            </Typography>
          ) : null}
        </Stack>
        <Button size="small" onClick={onReset} disabled={activeCount === 0}>
          Clear all
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(4, 1fr)',
          },
        }}
      >
        <TextField
          {...field}
          select
          label="Office"
          value={values.office}
          onChange={(event) => onChange('office', event.target.value)}
          helperText={officesLoading ? 'Loading offices…' : ' '}
        >
          <MenuItem value="">Any office</MenuItem>
          {officeOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          {...field}
          select
          label="Status"
          value={values.active}
          onChange={(event) => onChange('active', event.target.value)}
          helperText=" "
        >
          <MenuItem value="">Any status</MenuItem>
          <MenuItem value="true">Active only</MenuItem>
          <MenuItem value="false">Inactive only</MenuItem>
        </TextField>

        <TextField
          {...field}
          label="Make"
          placeholder="e.g. Ford"
          value={values.make}
          onChange={(event) => onChange('make', event.target.value)}
          helperText="Partial match"
        />

        <TextField
          {...field}
          label="Model"
          placeholder="e.g. Transit"
          value={values.model}
          onChange={(event) => onChange('model', event.target.value)}
          helperText="Partial match"
        />

        <TextField
          {...field}
          select
          label="Serviced by"
          value={values.certification_number}
          onChange={(event) => onChange('certification_number', event.target.value)}
          helperText="Mechanic certification no."
        >
          <MenuItem value="">Any mechanic</MenuItem>
          {mechanicOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        {/* Each picker constrains the other, so an inverted range cannot be
            selected in the first place -- the API would reject it with a 400,
            but the calendar simply not offering those days is better UX. */}
        <DateField
          label="Serviced from"
          value={values.maintained_from}
          onChange={(value) => onChange('maintained_from', value)}
          maxDate={values.maintained_to || todayIso()}
          helperText="Maintenance on or after"
        />

        <DateField
          label="Serviced to"
          value={values.maintained_to}
          onChange={(value) => onChange('maintained_to', value)}
          minDate={values.maintained_from || undefined}
          maxDate={todayIso()}
          helperText="Maintenance on or before"
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Date and mechanic filters match vehicles with a single maintenance record satisfying every
        condition set.
      </Typography>
    </Paper>
  );
}
