'use client';

/**
 * Create / edit a vehicle.
 *
 * Two things worth noting:
 *
 * - The duplicate-check endpoint is called as the VIN and plate are typed, so a
 *   clash is shown while the field is still in focus rather than as a rejected
 *   submit. `exclude_id` keeps a vehicle being edited from flagging itself.
 * - Server-side validation errors come back field-keyed, so they are shown
 *   under the field they belong to. The client does not try to mirror the
 *   backend's rules; the backend stays the single source of truth.
 */

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  checkDuplicate,
  createVehicle,
  parseApiError,
  updateVehicle,
  type FieldErrors,
} from '@/lib/api';
import { invalidateFleetData, queryKeys } from '@/lib/query-keys';
import { withCurrentValue } from '@/lib/select-options';
import { useDebounced } from '@/lib/use-debounced';
import type { Office, Vehicle, VehicleWriteInput } from '@/lib/types';

interface VehicleFormDialogProps {
  open: boolean;
  /** Absent when creating. */
  vehicle?: Vehicle | null;
  offices: Office[];
  onClose: () => void;
}

type FormState = {
  vin: string;
  license_plate: string;
  make: string;
  model: string;
  year: string;
  office: string;
  active: boolean;
};

const BLANK: FormState = {
  vin: '',
  license_plate: '',
  make: '',
  model: '',
  year: String(new Date().getFullYear()),
  office: '',
  active: true,
};

function toFormState(vehicle: Vehicle | null | undefined, offices: Office[]): FormState {
  if (!vehicle) {
    return { ...BLANK, office: offices[0] ? String(offices[0].id) : '' };
  }
  return {
    vin: vehicle.vin,
    license_plate: vehicle.license_plate,
    make: vehicle.make,
    model: vehicle.model,
    year: String(vehicle.year),
    office: String(vehicle.office),
    active: vehicle.active,
  };
}

export function VehicleFormDialog({ open, vehicle, offices, onClose }: VehicleFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(vehicle);

  const [form, setForm] = useState<FormState>(() => toFormState(vehicle, offices));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Clear the stale server error for a field the user is now fixing.
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const trimmedVin = form.vin.trim();
  const trimmedPlate = form.license_plate.trim();

  // Only ask about an active vehicle's plate: the backend allows an inactive
  // vehicle to reuse a live plate, so warning about it would be misleading.
  const plateToCheck = form.active ? trimmedPlate : '';

  // Debounced before it reaches the query key: every keystroke would otherwise
  // be a distinct key and so a fresh request, which also means staleTime never
  // applies. Typing a 17-character VIN was ~14 round trips.
  const vinToCheck = useDebounced(trimmedVin);
  const plateToCheckDebounced = useDebounced(plateToCheck);

  const duplicates = useQuery({
    queryKey: queryKeys.duplicateCheck(vinToCheck, plateToCheckDebounced, vehicle?.id),
    queryFn: () =>
      checkDuplicate({
        vin: vinToCheck || undefined,
        license_plate: plateToCheckDebounced || undefined,
        exclude_id: vehicle?.id,
      }),
    enabled: open && (vinToCheck.length > 3 || plateToCheckDebounced.length > 1),
    staleTime: 10_000,
  });

  const conflicts = duplicates.data?.conflicts ?? [];

  const save = useMutation({
    mutationFn: (input: VehicleWriteInput) =>
      isEdit && vehicle ? updateVehicle(vehicle.id, input) : createVehicle(input),
    onSuccess: () => {
      invalidateFleetData(queryClient);
      onClose();
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      setFieldErrors(parsed.fieldErrors);
      setMessage(parsed.message);
    },
  });

  const helper = (key: keyof FormState, fallback?: string) =>
    fieldErrors[key]?.join(' ') ?? fallback ?? ' ';

  const officeOptions = useMemo(
    () =>
      withCurrentValue(
        offices.map((office) => ({
          value: String(office.id),
          label: `${office.name} · ${office.city}`,
        })),
        form.office,
        `Office #${form.office}`,
      ),
    [form.office, offices],
  );

  const vinConflict = conflicts.includes('vin');
  const plateConflict = conflicts.includes('license_plate');

  const canSubmit = useMemo(
    () =>
      Boolean(trimmedVin && trimmedPlate && form.make.trim() && form.model.trim() && form.office) &&
      !save.isPending,
    [form.make, form.model, form.office, save.isPending, trimmedPlate, trimmedVin],
  );

  const handleSubmit = () => {
    setMessage(null);
    save.mutate({
      vin: trimmedVin,
      license_plate: trimmedPlate,
      make: form.make.trim(),
      model: form.model.trim(),
      year: form.year,
      office: form.office,
      active: form.active,
    });
  };

  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit vehicle' : 'Add vehicle'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {message ? <Alert severity="error">{message}</Alert> : null}

          <TextField
            label="VIN"
            value={form.vin}
            onChange={(event) => set('vin', event.target.value)}
            error={Boolean(fieldErrors.vin) || vinConflict}
            helperText={
              vinConflict
                ? 'A vehicle with this VIN already exists.'
                : helper('vin', 'Stored uppercase; must be unique.')
            }
            fullWidth
            required
          />

          <TextField
            label="License plate"
            value={form.license_plate}
            onChange={(event) => set('license_plate', event.target.value)}
            error={Boolean(fieldErrors.license_plate) || plateConflict}
            helperText={
              plateConflict
                ? 'An active vehicle already uses this plate.'
                : helper(
                    'license_plate',
                    'Only one active vehicle may hold a plate; retired plates can be reused.',
                  )
            }
            fullWidth
            required
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Make"
              value={form.make}
              onChange={(event) => set('make', event.target.value)}
              error={Boolean(fieldErrors.make)}
              helperText={helper('make')}
              fullWidth
              required
            />
            <TextField
              label="Model"
              value={form.model}
              onChange={(event) => set('model', event.target.value)}
              error={Boolean(fieldErrors.model)}
              helperText={helper('model')}
              fullWidth
              required
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Year"
              type="number"
              value={form.year}
              onChange={(event) => set('year', event.target.value)}
              error={Boolean(fieldErrors.year)}
              helperText={helper('year')}
              slotProps={{ htmlInput: { min: 1900, max: new Date().getFullYear() + 1 } }}
              fullWidth
              required
            />
            <TextField
              select
              label="Office"
              value={form.office}
              onChange={(event) => set('office', event.target.value)}
              error={Boolean(fieldErrors.office)}
              helperText={helper('office')}
              fullWidth
              required
            >
              {/* The edit form is seeded with the vehicle's office id, which may
                  not be in this list yet if the offices query is still in
                  flight. A stand-in keeps the Select's value valid rather than
                  rendering blank and warning. */}
              {officeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={form.active}
                onChange={(event) => set('active', event.target.checked)}
              />
            }
            label={form.active ? 'Active - in service' : 'Inactive - retired'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add vehicle'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
