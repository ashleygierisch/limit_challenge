'use client';

/**
 * Mechanics: CRUD plus the year-to-date workload report.
 *
 * Driven by `/mechanics/workload/`, which returns the roster already ranked
 * busiest first and carries the two figures worth showing per mechanic.
 */

import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QueryState } from '@/components/QueryState';
import { SortableTableHead, type SortableColumn } from '@/components/SortableTableHead';
import {
  createMechanic,
  deleteMechanic,
  fetchMechanicWorkload,
  parseApiError,
  updateMechanic,
  type FieldErrors,
} from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { useDiscardGuard, useIsDirty } from '@/lib/use-discard-guard';
import { useClientSort, type SortAccessors } from '@/lib/sorting';
import type { Mechanic, MechanicWorkload } from '@/lib/types';

// The workload report is unpaginated, so sorting is in-memory.
const ACCESSORS: SortAccessors<MechanicWorkload> = {
  name: { type: 'text', value: (row) => row.name },
  certification_number: { type: 'text', value: (row) => row.certification_number },
  active: { type: 'boolean', value: (row) => row.active },
  records_this_year: { type: 'number', value: (row) => row.records_this_year },
  cost_this_year: { type: 'number', value: (row) => row.cost_this_year },
};

/**
 * A workload row carries every field the edit form needs.
 *
 * The report reports `active` itself, so this page needs one request rather
 * than joining the workload against a separately fetched roster.
 */
function toMechanic(row: MechanicWorkload): Mechanic {
  return {
    id: row.id,
    name: row.name,
    certification_number: row.certification_number,
    active: row.active,
  };
}

export default function MechanicsPage() {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Mechanic | null>(null);
  const [formKey, setFormKey] = useState(0);

  const openForm = (mechanic: Mechanic | null) => {
    setEditing(mechanic);
    setFormKey((value) => value + 1);
    setFormOpen(true);
  };
  const [deleting, setDeleting] = useState<Mechanic | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const workload = useQuery({
    queryKey: queryKeys.mechanicWorkload,
    queryFn: fetchMechanicWorkload,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteMechanic(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mechanics });
      setDeleting(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(parseApiError(error).message),
  });

  const thisYear = new Date().getFullYear();

  const { sorted: rows, sort, toggle } = useClientSort(workload.data ?? [], ACCESSORS);

  const columns: SortableColumn[] = [
    // A row ordinal is a position, not a value, so it never sorts.
    { key: 'index', label: 'No', width: '5%', align: 'center', sortable: false },
    { key: 'name', label: 'Mechanic', width: '25%' },
    { key: 'certification_number', label: 'Certification', width: '17%' },
    { key: 'active', label: 'Status', width: '11%' },
    { key: 'records_this_year', label: `Jobs in ${thisYear}`, width: '13%', align: 'right' },
    { key: 'cost_this_year', label: `Value in ${thisYear}`, width: '17%', align: 'right' },
    { key: 'actions', label: 'Actions', width: '12%', align: 'right', sortable: false },
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        gap={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" component="h2">
            Mechanics
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Workload for {thisYear} to date, busiest first.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => openForm(null)}
          sx={{ whiteSpace: 'nowrap' }}
        >
          Add mechanic
        </Button>
      </Stack>

      <Paper variant="outlined">
        <QueryState
          isPending={workload.isPending}
          isError={workload.isError}
          error={workload.error}
          onRetry={() => workload.refetch()}
          isEmpty={rows.length === 0}
          emptyTitle="No mechanics yet"
          emptyMessage="Add a mechanic before logging maintenance - every record names one."
        >
          <TableContainer
            sx={{ opacity: workload.isFetching ? 0.6 : 1, transition: 'opacity 120ms' }}
          >
            <Table sx={{ tableLayout: 'fixed', minWidth: 880 }}>
              <SortableTableHead columns={columns} sort={sort} onSort={toggle} />
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.id} hover>
                    <TableCell align="center" sx={{ color: 'text.secondary' }}>
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {row.name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
                      {row.certification_number}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={row.active ? 'success' : 'default'}
                        label={row.active ? 'Active' : 'Inactive'}
                      />
                    </TableCell>
                    <TableCell align="right">{row.records_this_year}</TableCell>
                    <TableCell align="right">{formatCurrency(row.cost_this_year)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" gap={0.5}>
                        <Tooltip title="Edit mechanic">
                          <IconButton
                            size="small"
                            aria-label={`Edit ${row.name}`}
                            onClick={() => openForm(toMechanic(row))}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete mechanic">
                          <IconButton
                            size="small"
                            aria-label={`Delete ${row.name}`}
                            onClick={() => {
                              setDeleting(toMechanic(row));
                              setDeleteError(null);
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </QueryState>
      </Paper>

      <MechanicFormDialog
        key={`form-${formKey}`}
        open={formOpen}
        mechanic={editing}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete mechanic?"
        message={
          deleting
            ? `${deleting.name} will be removed. Mechanics with maintenance history cannot be deleted - mark them inactive instead.`
            : ''
        }
        error={deleteError}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      />
    </Container>
  );
}

function MechanicFormDialog({
  open,
  mechanic,
  onClose,
}: {
  open: boolean;
  mechanic: Mechanic | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(mechanic);

  const [form, setForm] = useState({
    name: mechanic?.name ?? '',
    certification_number: mechanic?.certification_number ?? '',
    active: mechanic?.active ?? true,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  // An accidental backdrop click or Escape must not discard a half-filled form.
  const dirty = useIsDirty(form);
  const guard = useDiscardGuard(dirty, onClose);

  const save = useMutation({
    mutationFn: () =>
      isEdit && mechanic ? updateMechanic(mechanic.id, form) : createMechanic(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mechanics });
      onClose();
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      setFieldErrors(parsed.fieldErrors);
      setMessage(parsed.message);
    },
  });

  return (
    <>
      <Dialog
        open={open}
        onClose={save.isPending ? undefined : guard.handleDialogClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{isEdit ? 'Edit mechanic' : 'Add mechanic'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {message ? <Alert severity="error">{message}</Alert> : null}
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name?.join(' ') ?? ' '}
              fullWidth
              required
            />
            <TextField
              label="Certification number"
              value={form.certification_number}
              onChange={(event) =>
                setForm((f) => ({ ...f, certification_number: event.target.value }))
              }
              error={Boolean(fieldErrors.certification_number)}
              helperText={fieldErrors.certification_number?.join(' ') ?? 'Must be unique.'}
              fullWidth
              required
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))}
                />
              }
              label={form.active ? 'Active' : 'Inactive'}
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
            disabled={save.isPending || !form.name.trim() || !form.certification_number.trim()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
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
