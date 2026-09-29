'use client';

/**
 * Create or edit a maintenance record.
 *
 * One dialog for both, so the two paths cannot drift apart in validation or
 * layout, and so it matches the vehicle, office and mechanic dialogs rather
 * than being the one form in the app that behaves differently.

 */

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  createMaintenanceRecord,
  parseApiError,
  updateMaintenanceRecord,
  type FieldErrors,
} from '@/lib/api';
import { todayIso } from '@/lib/format';
import { invalidateFleetData } from '@/lib/query-keys';
import {
  MAINTENANCE_TYPES,
  type MaintenanceType,
  type Mechanic,
  type VehicleMaintenanceRecord,
} from '@/lib/types';
import { useDiscardGuard, useIsDirty } from '@/lib/use-discard-guard';
import { ConfirmDialog } from './ConfirmDialog';
import { DateField } from './DateField';

interface MaintenanceRecordDialogProps {
  open: boolean;
  vehicleId: number;
  /** Absent when logging a new record. */
  record?: VehicleMaintenanceRecord | null;
  mechanics: Mechanic[];
  onClose: () => void;
  onSaved: () => void;
}

export function MaintenanceRecordDialog({
  open,
  vehicleId,
  record,
  mechanics,
  onClose,
  onSaved,
}: MaintenanceRecordDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(record);

  const [form, setForm] = useState({
    mechanic: record ? String(record.mechanic.id) : '',
    maintenance_date: record?.maintenance_date ?? todayIso(),
    maintenance_type: (record?.maintenance_type ?? 'scheduled') as MaintenanceType,
    cost: record?.cost ?? '',
    notes: record?.notes ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  // An accidental backdrop click or Escape must not discard a half-filled form.
  const dirty = useIsDirty(form);
  const guard = useDiscardGuard(dirty, onClose);

  /**
   * Mechanics offered by the dropdown.
   *
   * New work goes to active mechanics only, but an existing record may name one
   * who has since been retired. Dropping them would leave the Select with a
   * value matching none of its options — it would render blank and warn — and
   * would silently reassign the record on save, so they are kept and marked.
   */
  const mechanicOptions = useMemo(() => {
    const active = mechanics.filter((mechanic) => mechanic.active);
    if (!record) return active;
    if (active.some((mechanic) => mechanic.id === record.mechanic.id)) return active;
    return [record.mechanic, ...active];
  }, [mechanics, record]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Clear the stale server error for a field being corrected.
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        vehicle: vehicleId,
        mechanic: form.mechanic,
        maintenance_date: form.maintenance_date,
        maintenance_type: form.maintenance_type,
        cost: form.cost,
        notes: form.notes,
      };
      return record
        ? updateMaintenanceRecord(record.id, payload)
        : createMaintenanceRecord(payload);
    },
    onSuccess: () => {
      invalidateFleetData(queryClient);
      onSaved();
      onClose();
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      setFieldErrors(parsed.fieldErrors);
      setMessage(parsed.message);
    },
  });

  const helper = (key: string, fallback = ' ') => fieldErrors[key]?.join(' ') ?? fallback;

  return (
    <>
      <Dialog
        open={open}
        onClose={save.isPending ? undefined : guard.handleDialogClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{isEdit ? 'Edit maintenance record' : 'Log service'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {message ? <Alert severity="error">{message}</Alert> : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                size="small"
                label="Mechanic"
                value={form.mechanic}
                onChange={(event) => set('mechanic', event.target.value)}
                error={Boolean(fieldErrors.mechanic)}
                helperText={helper('mechanic')}
                fullWidth
                required
              >
                {mechanicOptions.map((mechanic) => (
                  <MenuItem key={mechanic.id} value={String(mechanic.id)}>
                    {mechanic.name} · {mechanic.certification_number}
                    {mechanic.active ? '' : ' (inactive)'}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                size="small"
                label="Type"
                value={form.maintenance_type}
                onChange={(event) => set('maintenance_type', event.target.value as MaintenanceType)}
                error={Boolean(fieldErrors.maintenance_type)}
                helperText={helper('maintenance_type')}
                fullWidth
              >
                {MAINTENANCE_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DateField
                label="Date"
                value={form.maintenance_date}
                onChange={(value) => set('maintenance_date', value)}
                error={Boolean(fieldErrors.maintenance_date)}
                helperText={helper('maintenance_date')}
                // The API rejects future dates -- a record documents completed
                // work -- so the calendar does not offer them.
                maxDate={todayIso()}
                required
              />
              <TextField
                size="small"
                label="Cost"
                value={form.cost}
                onChange={(event) => set('cost', event.target.value)}
                error={Boolean(fieldErrors.cost)}
                helperText={helper('cost')}
                placeholder="0.00"
                fullWidth
                required
              />
            </Stack>

            <TextField
              size="small"
              label="Notes"
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
              error={Boolean(fieldErrors.notes)}
              helperText={helper('notes')}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={guard.requestClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setMessage(null);
              save.mutate();
            }}
            disabled={save.isPending || !form.mechanic || !form.cost}
          >
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Save record'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={guard.confirming}
        title="Discard changes?"
        message="This form has unsaved changes. Closing it will lose them."
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.keepEditing}
      />
    </>
  );
}
