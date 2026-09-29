'use client';

import {
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SortableTableHead, type SortableColumn } from '@/components/SortableTableHead';
import { QueryState } from '@/components/QueryState';
import { VehicleFilters } from '@/components/VehicleFilters';
import { VehicleFormDialog } from '@/components/VehicleFormDialog';
import {
  deleteVehicle,
  fetchAllMechanics,
  fetchAllOffices,
  parseApiError,
  searchVehicles,
  PAGE_SIZE,
} from '@/lib/api';
import { invalidateFleetData, queryKeys } from '@/lib/query-keys';
import { toOrderingParam } from '@/lib/sorting';
import type { Vehicle } from '@/lib/types';
import { rememberReturnTo } from '@/lib/return-to';
import { useVehicleFilters } from '@/lib/use-vehicle-filters';

// Header key -> the model fields the API orders by. The "Vehicle" column shows
// make, model and year, so it sorts by all three; Office sorts by the related
// office's name rather than its id, which would be meaningless to a reader.
const ORDERING_FIELDS = {
  vehicle: { fields: ['make', 'model', 'year'] },
  license_plate: { fields: ['license_plate'] },
  vin: { fields: ['vin'] },
  office: { fields: ['office__name'] },
  active: { fields: ['active'] },
};

const COLUMNS: SortableColumn[] = [
  { key: 'index', label: 'No', width: '5%', align: 'center', sortable: false },
  { key: 'vehicle', label: 'Vehicle', width: '21%' },
  { key: 'vin', label: 'VIN', width: '19%' },
  { key: 'license_plate', label: 'Plate', width: '13%' },
  { key: 'office', label: 'Office', width: '18%' },
  { key: 'active', label: 'Status', width: '11%' },
  // Buttons, not a value.
  { key: 'actions', label: 'Actions', width: '13%', align: 'right', sortable: false },
];

export default function VehiclesPage() {
  // useSearchParams needs a Suspense boundary so the shell around it can still
  // be prerendered.
  return (
    <Suspense fallback={null}>
      <VehiclesView />
    </Suspense>
  );
}

function VehiclesView() {
  const queryClient = useQueryClient();

  const { filters, values, page, sort, activeCount, setFilter, setPage, toggleSort, reset } =
    useVehicleFilters();

  // Sorting is server-side: the table holds one page, so ordering has to be
  // applied across the whole result set rather than to the rows in hand.
  const ordering = toOrderingParam(sort, ORDERING_FIELDS);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  // Remount counter. Incremented when the form opens and used as its `key`, so
  // each open starts from clean state without the child resetting itself in an
  // effect. It deliberately does not change on close, which keeps the closing
  // transition intact.
  const [formKey, setFormKey] = useState(0);

  const openForm = (vehicle: Vehicle | null) => {
    setEditing(vehicle);
    setFormKey((value) => value + 1);
    setFormOpen(true);
  };
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const vehicles = useQuery({
    queryKey: queryKeys.vehicleSearch(filters, page, ordering),
    queryFn: () => searchVehicles(filters, page, ordering),
    // Keeps the previous page on screen while the next one loads, so paging and
    // filtering do not flash an empty table.
    placeholderData: (previous) => previous,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteVehicle(id),
    onSuccess: () => {
      invalidateFleetData(queryClient);
      setDeleting(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(parseApiError(error).message),
  });

  const rows = vehicles.data?.results ?? [];
  const total = vehicles.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
            Vehicles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search the fleet, inspect maintenance history, and keep records current.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => openForm(null)}
          disabled={offices.data?.length === 0}
          sx={{ whiteSpace: 'nowrap' }}
        >
          Add vehicle
        </Button>
      </Stack>

      <Stack spacing={3}>
        <VehicleFilters
          values={values}
          activeCount={activeCount}
          offices={offices.data ?? []}
          mechanics={mechanics.data ?? []}
          officesLoading={offices.isPending}
          resultCount={vehicles.data ? total : undefined}
          onChange={setFilter}
          onReset={reset}
        />

        <Paper variant="outlined">
          <QueryState
            isPending={vehicles.isPending}
            isError={vehicles.isError}
            error={vehicles.error}
            onRetry={() => vehicles.refetch()}
            isEmpty={rows.length === 0}
            emptyTitle={activeCount > 0 ? 'No vehicles match these filters' : 'No vehicles yet'}
            emptyMessage={
              activeCount > 0
                ? 'Try widening or clearing a filter.'
                : 'Add a vehicle, or run the seed_fleet management command for sample data.'
            }
            emptyAction={
              activeCount > 0 ? (
                <Button variant="outlined" onClick={reset}>
                  Clear filters
                </Button>
              ) : null
            }
            skeletonRows={PAGE_SIZE}
          >
            <TableContainer
              sx={{
                // Dim, rather than replace, the table while a refetch is in
                // flight: the old rows stay readable and the layout is stable.
                opacity: vehicles.isFetching ? 0.6 : 1,
                transition: 'opacity 120ms',
              }}
            >
              {/* Fixed layout with explicit widths. Auto layout sizes columns
                  from whatever happens to be on the current page, so the VIN
                  column visibly jumps as you page through the fleet. A minWidth
                  keeps it readable and lets the container scroll on a phone. */}
              <Table sx={{ tableLayout: 'fixed', minWidth: 900 }}>
                <SortableTableHead columns={COLUMNS} sort={sort} onSort={toggleSort} />
                <TableBody>
                  {rows.map((vehicle, index) => (
                    <TableRow key={vehicle.id} hover>
                      {/* Continues across pages: page 2 starts at 11, not 1. */}
                      <TableCell align="center" sx={{ color: 'text.secondary' }}>
                        {(page - 1) * PAGE_SIZE + index + 1}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {vehicle.make} {vehicle.model}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {vehicle.year}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ p: 0 }}>
                        <Tooltip title={vehicle.vin}>
                          <Box
                            sx={{
                              px: 2,
                              py: 2,
                              fontFamily: 'var(--font-geist-mono), monospace',
                              fontSize: '0.78rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {vehicle.vin}
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
                        {vehicle.license_plate}
                      </TableCell>

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {vehicle.office_detail?.name ?? '-'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={vehicle.active ? 'success' : 'default'}
                          label={vehicle.active ? 'Active' : 'Retired'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" justifyContent="flex-end" gap={0.25}>
                          <Button
                            size="small"
                            component={Link}
                            href={`/vehicles/${vehicle.id}`}
                            onClick={() => rememberReturnTo('Vehicles')}
                          >
                            View
                          </Button>
                          <Tooltip title="Edit vehicle">
                            <IconButton
                              size="small"
                              aria-label={`Edit ${vehicle.license_plate}`}
                              onClick={() => openForm(vehicle)}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete vehicle">
                            <IconButton
                              size="small"
                              aria-label={`Delete ${vehicle.license_plate}`}
                              onClick={() => {
                                setDeleting(vehicle);
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

            {pageCount > 1 ? (
              <Stack alignItems="center" sx={{ py: 2 }}>
                <Pagination
                  count={pageCount}
                  page={page}
                  onChange={(_, next) => setPage(next)}
                  color="primary"
                />
              </Stack>
            ) : null}
          </QueryState>
        </Paper>
      </Stack>

      <VehicleFormDialog
        key={`form-${formKey}`}
        open={formOpen}
        vehicle={editing}
        offices={offices.data ?? []}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete vehicle?"
        message={
          deleting
            ? `${deleting.year} ${deleting.make} ${deleting.model} (${deleting.license_plate}) and its maintenance history will be permanently removed. Consider marking it retired instead.`
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
