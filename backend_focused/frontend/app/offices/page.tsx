'use client';

/**
 * Offices: CRUD plus the office summary report.
 *
 * The table is driven by `/offices/summary/` rather than the plain list, since
 * it already carries the name, city and the three figures worth seeing next to
 * each other - one request instead of two.
 */

import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
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
import Link from 'next/link';
import { useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { QueryState } from '@/components/QueryState';
import { SortableTableHead, type SortableColumn } from '@/components/SortableTableHead';
import {
  createOffice,
  deleteOffice,
  fetchOfficeSummary,
  parseApiError,
  updateOffice,
  type FieldErrors,
} from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { useClientSort, type SortAccessors } from '@/lib/sorting';
import type { OfficeSummary } from '@/lib/types';

/**
 * Link to the vehicles behind an office's 12-month spend figure.
 *
 * The window comes from the response rather than being re-derived here, so the
 * list cannot disagree with the figure it was clicked from.
 *
 * Deliberately no `active` filter, unlike the vehicle-count link beside it:
 * spend includes work done on vehicles that have since been retired, so
 * filtering to active ones would show a narrower set than the figure covers.
 */
function spendHref(office: OfficeSummary) {
  const params = new URLSearchParams({
    office: String(office.id),
    maintained_from: office.maintenance_window_start,
    maintained_to: office.maintenance_window_end,
  });
  return `/?${params.toString()}`;
}

const COLUMNS: SortableColumn[] = [
  { key: 'index', label: 'No', width: '5%', align: 'center', sortable: false },
  { key: 'name', label: 'Office', width: '23%' },
  { key: 'city', label: 'City', width: '19%' },
  { key: 'active_vehicle_count', label: 'Active vehicles', width: '13%', align: 'right' },
  { key: 'maintenance_cost_last_year', label: 'Spend (12 mo)', width: '15%', align: 'right' },
  { key: 'last_maintenance', label: 'Last service', width: '15%' },
  { key: 'actions', label: 'Actions', width: '10%', align: 'right', sortable: false },
];

// The summary endpoint is unpaginated, so every row is already here and sorting
// is in-memory -- no extra request. Types are declared because counts and money
// arrive as strings and would otherwise sort lexicographically.
const ACCESSORS: SortAccessors<OfficeSummary> = {
  name: { type: 'text', value: (row) => row.name },
  city: { type: 'text', value: (row) => row.city },
  active_vehicle_count: { type: 'number', value: (row) => row.active_vehicle_count },
  maintenance_cost_last_year: {
    type: 'number',
    value: (row) => row.maintenance_cost_last_year,
  },
  last_maintenance: { type: 'date', value: (row) => row.last_maintenance },
};

export default function OfficesPage() {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeSummary | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<OfficeSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: queryKeys.officeSummary,
    queryFn: fetchOfficeSummary,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteOffice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offices });
      setDeleting(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(parseApiError(error).message),
  });

  const { sorted: rows, sort, toggle } = useClientSort(summary.data ?? [], ACCESSORS);

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
            Offices
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Active vehicles, maintenance spend over the last 12 months, and the most recent service
            at each location.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setFormKey((value) => value + 1);
            setFormOpen(true);
          }}
        >
          Add office
        </Button>
      </Stack>

      <Paper variant="outlined">
        <QueryState
          isPending={summary.isPending}
          isError={summary.isError}
          error={summary.error}
          onRetry={() => summary.refetch()}
          isEmpty={rows.length === 0}
          emptyTitle="No offices yet"
          emptyMessage="Add an office before adding vehicles - every vehicle belongs to one."
        >
          <TableContainer
            sx={{ opacity: summary.isFetching ? 0.6 : 1, transition: 'opacity 120ms' }}
          >
            {/* Fixed layout: auto layout sizes columns from the current page's
                content, so the edges shift as data changes. */}
            <Table sx={{ tableLayout: 'fixed', minWidth: 860 }}>
              <SortableTableHead columns={COLUMNS} sort={sort} onSort={toggle} />
              <TableBody>
                {rows.map((office, index) => (
                  <TableRow key={office.id} hover>
                    {/* Unpaginated report, so the ordinal is simply the position. */}
                    <TableCell align="center" sx={{ color: 'text.secondary' }}>
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {office.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{office.city}</TableCell>
                    <TableCell align="right">
                      {office.active_vehicle_count > 0 ? (
                        <Tooltip
                          title={`View the ${office.active_vehicle_count} active vehicles at ${office.name}`}
                        >
                          {/* Links to the vehicle list with this office and
                              active=true already applied. The filters live in
                              the URL, so this is just a URL -- no extra state
                              handoff, and the target page is shareable. */}
                          <Button
                            component={Link}
                            href={`/?office=${office.id}&active=true`}
                            size="small"
                            endIcon={<ArrowForwardIcon fontSize="small" />}
                            sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {office.active_vehicle_count}
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" color="text.secondary" component="span">
                          0
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {Number(office.maintenance_cost_last_year) > 0 ? (
                        <Tooltip
                          title={`View the vehicles serviced at ${office.name} in the last 12 months`}
                        >
                          <Button
                            component={Link}
                            href={spendHref(office)}
                            size="small"
                            endIcon={<ArrowForwardIcon fontSize="small" />}
                            sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatCurrency(office.maintenance_cost_last_year)}
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" color="text.secondary" component="span">
                          {formatCurrency(office.maintenance_cost_last_year)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(office.last_maintenance)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" gap={0.5}>
                        <Tooltip title="Edit office">
                          <IconButton
                            size="small"
                            aria-label={`Edit ${office.name}`}
                            onClick={() => {
                              setEditing(office);
                              setFormKey((value) => value + 1);
                              setFormOpen(true);
                            }}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete office">
                          <IconButton
                            size="small"
                            aria-label={`Delete ${office.name}`}
                            onClick={() => {
                              setDeleting(office);
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

      <OfficeFormDialog
        key={`form-${formKey}`}
        open={formOpen}
        office={editing}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete office?"
        message={
          deleting
            ? `${deleting.name} will be removed. Offices with vehicles assigned cannot be deleted - reassign them first.`
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

function OfficeFormDialog({
  open,
  office,
  onClose,
}: {
  open: boolean;
  office: OfficeSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(office);

  const [form, setForm] = useState({
    name: office?.name ?? '',
    city: office?.city ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => (isEdit && office ? updateOffice(office.id, form) : createOffice(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offices });
      onClose();
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      setFieldErrors(parsed.fieldErrors);
      setMessage(parsed.message);
    },
  });

  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEdit ? 'Edit office' : 'Add office'}</DialogTitle>
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
            label="City"
            value={form.city}
            onChange={(event) => setForm((f) => ({ ...f, city: event.target.value }))}
            error={Boolean(fieldErrors.city)}
            helperText={fieldErrors.city?.join(' ') ?? ' '}
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            setMessage(null);
            save.mutate();
          }}
          disabled={save.isPending || !form.name.trim() || !form.city.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
