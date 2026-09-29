'use client';

/**
 * Vehicle detail.
 *
 * A route rather than a drawer: the maintenance history is the densest table in
 * the app and needs the full page width, and a vehicle is then linkable,
 * survives a reload and works with the back button.
 */

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Container,
  Divider,
  IconButton,
  MenuItem,
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
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MaintenanceRecordDialog } from '@/components/MaintenanceRecordDialog';
import { QueryState } from '@/components/QueryState';
import { SortableTableHead, type SortableColumn } from '@/components/SortableTableHead';
import { VehicleFormDialog } from '@/components/VehicleFormDialog';
import {
  assignVehicle,
  deleteMaintenanceRecord,
  deleteVehicle,
  fetchAllMechanics,
  fetchAllOffices,
  fetchVehicle,
  parseApiError,
} from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { invalidateFleetData, queryKeys } from '@/lib/query-keys';
import { useReturnTo } from '@/lib/return-to';
import { useClientSort, type SortAccessors } from '@/lib/sorting';
import type { Vehicle, VehicleMaintenanceRecord } from '@/lib/types';

const HISTORY_COLUMNS: SortableColumn[] = [
  { key: 'index', label: 'No', width: '6%', align: 'center', sortable: false },
  { key: 'maintenance_date', label: 'Date', width: '12%' },
  { key: 'maintenance_type', label: 'Type', width: '16%' },
  { key: 'mechanic', label: 'Mechanic', align: 'center', width: '20%' },
  { key: 'cost', label: 'Cost', width: '9%' },
  { key: 'notes', label: 'Notes', width: '25%', align: 'center', sortable: false },
  { key: 'actions', label: '', width: '12%', align: 'center', sortable: false },
];

// The detail endpoint returns the whole history in one payload, so sorting is
// in-memory. Cost is a decimal string, hence the explicit number type.
const HISTORY_ACCESSORS: SortAccessors<VehicleMaintenanceRecord> = {
  maintenance_date: { type: 'date', value: (row) => row.maintenance_date },
  maintenance_type: { type: 'text', value: (row) => row.maintenance_type_display },
  mechanic: { type: 'text', value: (row) => row.mechanic.name },
  cost: { type: 'number', value: (row) => row.cost },
};

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Where this page was opened from, so leaving restores that list's filters,
  // sort and page rather than dropping the user on an unfiltered list.
  const returnTo = useReturnTo();

  const vehicleId = Number(params.id);
  const validId = Number.isInteger(vehicleId) && vehicleId > 0;

  const [assignTo, setAssignTo] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VehicleMaintenanceRecord | null>(null);
  const [recordDialogKey, setRecordDialogKey] = useState(0);

  const openRecordDialog = (record: VehicleMaintenanceRecord | null) => {
    setEditingRecord(record);
    setRecordDialogKey((value) => value + 1);
    setRecordDialogOpen(true);
  };
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const [recordToDelete, setRecordToDelete] = useState<VehicleMaintenanceRecord | null>(null);
  const [deleteVehicleOpen, setDeleteVehicleOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: queryKeys.vehicle(vehicleId),
    queryFn: () => fetchVehicle(vehicleId),
    enabled: validId,
  });

  const offices = useQuery({
    queryKey: queryKeys.allOffices,
    queryFn: fetchAllOffices,
    staleTime: 5 * 60_000,
  });

  const mechanics = useQuery({
    queryKey: queryKeys.allMechanics,
    queryFn: fetchAllMechanics,
    staleTime: 5 * 60_000,
  });

  const vehicle = detail.data;

  const {
    sorted: history,
    sort,
    toggle,
  } = useClientSort(vehicle?.maintenance_records ?? [], HISTORY_ACCESSORS);

  // The detail endpoint nests the office; the edit form writes it by id.
  const editable: Vehicle | null = vehicle
    ? {
        id: vehicle.id,
        vin: vehicle.vin,
        license_plate: vehicle.license_plate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        office: vehicle.office.id,
        office_detail: vehicle.office,
        active: vehicle.active,
      }
    : null;

  // Read from the unsorted payload, which the API returns newest-first. Taking
  // history[0] would follow whatever the user last sorted by, so sorting the
  // table ascending would relabel the oldest service as the most recent.
  const lastService = vehicle?.maintenance_records[0]?.maintenance_date ?? null;

  const invalidate = () => {
    invalidateFleetData(queryClient);
  };

  const assign = useMutation({
    mutationFn: (officeId: number) => assignVehicle(vehicleId, officeId),
    onSuccess: () => {
      setAssignTo('');
      setAssignError(null);
      invalidate();
    },
    onError: (error) => {
      const parsed = parseApiError(error);
      setAssignError(parsed.fieldErrors.office?.join(' ') ?? parsed.message);
    },
  });

  const removeRecord = useMutation({
    mutationFn: (id: number) => deleteMaintenanceRecord(id),
    onSuccess: () => {
      setRecordToDelete(null);
      setDeleteError(null);
      invalidate();
    },
    onError: (error) => setDeleteError(parseApiError(error).message),
  });

  const removeVehicle = useMutation({
    mutationFn: () => deleteVehicle(vehicleId),
    onSuccess: () => {
      invalidate();
      // Nothing left to show here once the vehicle is gone. Back to the plain
      // list rather than the remembered one: that view was built around a
      // vehicle that no longer exists.
      router.push('/');
    },
    onError: (error) => setDeleteError(parseApiError(error).message),
  });

  // A 404 is not a failure to load -- the vehicle is simply gone, which is what
  // a stale link or a just-deleted vehicle looks like. Showing the red "could
  // not load" panel for it would suggest something is broken.
  const notFound =
    detail.isError && detail.error instanceof AxiosError && detail.error.response?.status === 404;

  if (notFound) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h6">This vehicle no longer exists</Typography>
          <Typography variant="body2" color="text.secondary">
            It may have been deleted since this link was created.
          </Typography>
          <Button
            component={Link}
            href={returnTo.url}
            variant="outlined"
            startIcon={<ArrowBackIcon />}
          >
            Back to {returnTo.label.toLowerCase()}
          </Button>
        </Stack>
      </Container>
    );
  }

  if (!validId) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">&quot;{params.id}&quot; is not a valid vehicle id.</Alert>
        <Button component={Link} href={returnTo.url} startIcon={<ArrowBackIcon />} sx={{ mt: 2 }}>
          Back to {returnTo.label.toLowerCase()}
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        {/* A link rather than router.back(), so a page opened from a shared URL
            or a new tab still has somewhere sensible to go. The href carries
            the originating list's query string when there is one. */}
        <Button
          component={Link}
          href={returnTo.url}
          size="small"
          startIcon={<ArrowBackIcon />}
          sx={{ textTransform: 'none' }}
        >
          {returnTo.label}
        </Button>
      </Breadcrumbs>

      <QueryState
        isPending={detail.isPending}
        isError={detail.isError}
        error={detail.error}
        onRetry={() => detail.refetch()}
        skeletonRows={8}
      >
        {vehicle ? (
          <Stack spacing={3}>
            {/* -- header -- */}
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ md: 'flex-start' }}
              gap={2}
            >
              <Box>
                <Typography variant="h5" component="h2">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </Typography>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                  <Chip
                    size="small"
                    color={vehicle.active ? 'success' : 'default'}
                    label={vehicle.active ? 'Active' : 'Retired'}
                  />
                  <Chip size="small" variant="outlined" label={vehicle.license_plate} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`VIN ${vehicle.vin}`}
                    sx={{ fontFamily: 'var(--font-geist-mono), monospace' }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${vehicle.office.name} · ${vehicle.office.city}`}
                  />
                </Stack>
              </Box>
              <Stack direction="row" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => {
                    setEditKey((value) => value + 1);
                    setEditOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => {
                    setDeleteVehicleOpen(true);
                    setDeleteError(null);
                  }}
                >
                  Delete
                </Button>
              </Stack>
            </Stack>

            {/* -- figures -- */}
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: 'repeat(2, 1fr)',
                  md: 'repeat(4, 1fr)',
                },
              }}
            >
              <StatCard label="Maintenance records" value={vehicle.maintenance_count} />
              <StatCard
                label="Lifetime cost"
                value={formatCurrency(vehicle.total_maintenance_cost)}
              />
              <StatCard label="Last service" value={formatDate(lastService)} />
              <StatCard label="Office" value={vehicle.office.name} />
            </Box>

            {/* -- reassign -- */}
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Reassign office
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems="flex-start">
                <TextField
                  select
                  size="small"
                  label="Move to"
                  value={assignTo}
                  onChange={(event) => {
                    setAssignTo(event.target.value);
                    setAssignError(null);
                  }}
                  sx={{ minWidth: 280 }}
                >
                  {offices.data
                    ?.filter((office) => office.id !== vehicle.office.id)
                    .map((office) => (
                      <MenuItem key={office.id} value={String(office.id)}>
                        {office.name} · {office.city}
                      </MenuItem>
                    ))}
                </TextField>
                <Button
                  variant="outlined"
                  startIcon={<SwapHorizIcon />}
                  disabled={!assignTo || assign.isPending}
                  onClick={() => assign.mutate(Number(assignTo))}
                  sx={{ mt: 0.25, whiteSpace: 'nowrap' }}
                >
                  {assign.isPending ? 'Moving…' : 'Move'}
                </Button>
              </Stack>
              {assignError ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {assignError}
                </Alert>
              ) : null}
              {assign.isSuccess && !assignError ? (
                <Alert severity="success" sx={{ mt: 1.5 }}>
                  Vehicle moved. Only the office assignment changed.
                </Alert>
              ) : null}
            </Paper>

            <Divider />

            {/* -- history -- */}
            <Box>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1.5 }}
                gap={2}
                flexWrap="wrap"
              >
                <Typography variant="h6" component="h3">
                  Maintenance history ({vehicle.maintenance_count})
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => openRecordDialog(null)}
                >
                  Log service
                </Button>
              </Stack>

              {history.length === 0 ? (
                <Alert severity="info">This vehicle has never been serviced.</Alert>
              ) : (
                <Paper variant="outlined">
                  <TableContainer sx={{ maxHeight: 620 }}>
                    <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', minWidth: 900 }}>
                      <SortableTableHead columns={HISTORY_COLUMNS} sort={sort} onSort={toggle} />
                      <TableBody>
                        {history.map((record, index) => (
                          <TableRow key={record.id} hover>
                            <TableCell align="center" sx={{ color: 'text.secondary' }}>
                              {index + 1}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {formatDate(record.maintenance_date)}
                            </TableCell>
                            <TableCell>{record.maintenance_type_display}</TableCell>
                            <TableCell>
                              <Typography variant="body2">{record.mechanic.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {record.mechanic.certification_number}
                              </Typography>
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {formatCurrency(record.cost)}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" color="text.secondary">
                                {record.notes || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              <Tooltip title="Edit this record">
                                <IconButton
                                  size="small"
                                  aria-label={`Edit ${record.maintenance_type_display} record from ${formatDate(record.maintenance_date)}`}
                                  onClick={() => openRecordDialog(record)}
                                >
                                  <EditOutlinedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete this record">
                                <IconButton
                                  size="small"
                                  aria-label={`Delete ${record.maintenance_type_display} record from ${formatDate(record.maintenance_date)}`}
                                  onClick={() => {
                                    setRecordToDelete(record);
                                    setDeleteError(null);
                                  }}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                The full history loads in two queries regardless of its length.
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </QueryState>

      {editable ? (
        <VehicleFormDialog
          key={editKey}
          open={editOpen}
          vehicle={editable}
          offices={offices.data ?? []}
          onClose={() => setEditOpen(false)}
        />
      ) : null}

      <MaintenanceRecordDialog
        key={`record-${recordDialogKey}`}
        open={recordDialogOpen}
        vehicleId={vehicleId}
        record={editingRecord}
        mechanics={mechanics.data ?? []}
        onClose={() => setRecordDialogOpen(false)}
        onSaved={invalidate}
      />

      <ConfirmDialog
        open={recordToDelete !== null}
        title="Delete maintenance record?"
        message={
          recordToDelete
            ? `The ${recordToDelete.maintenance_type_display.toLowerCase()} on ${formatDate(
                recordToDelete.maintenance_date,
              )} by ${recordToDelete.mechanic.name} (${formatCurrency(
                recordToDelete.cost,
              )}) will be permanently deleted. This cannot be undone, and it will change this vehicle's totals, the office spend report and the mechanic's workload.`
            : ''
        }
        confirmLabel="Delete record"
        error={deleteError}
        busy={removeRecord.isPending}
        onConfirm={() => recordToDelete && removeRecord.mutate(recordToDelete.id)}
        onClose={() => {
          setRecordToDelete(null);
          setDeleteError(null);
        }}
      />

      <ConfirmDialog
        open={deleteVehicleOpen}
        title="Delete vehicle?"
        message={
          vehicle
            ? `${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.license_plate}) and its ${vehicle.maintenance_count} maintenance records will be permanently removed. Consider marking it retired instead.`
            : ''
        }
        error={deleteError}
        busy={removeVehicle.isPending}
        onConfirm={() => removeVehicle.mutate()}
        onClose={() => {
          setDeleteVehicleOpen(false);
          setDeleteError(null);
        }}
      />
    </Container>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Paper>
  );
}
