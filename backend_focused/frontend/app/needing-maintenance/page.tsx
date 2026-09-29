'use client';

/**
 * The chosen extra endpoint: `/vehicles/needing-maintenance/`.
 *
 * Picked because it is the one report that is a worklist rather than a readout -
 * a fleet manager can act on every row - and it exercises the trickiest
 * ordering rule in the API (never-serviced vehicles sort ahead of merely
 * overdue ones).
 */

import {
  Alert,
  Box,
  Chip,
  Container,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { QueryState } from '@/components/QueryState';
import { SortableTableHead, type SortableColumn } from '@/components/SortableTableHead';
import { PAGE_SIZE, fetchVehiclesNeedingMaintenance } from '@/lib/api';
import { formatAge, formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { rememberReturnTo } from '@/lib/return-to';
import { nextSortState, toOrderingParam, type SortState } from '@/lib/sorting';

const ORDERING_FIELDS = {
  vehicle: { fields: ['make', 'model', 'year'] },
  license_plate: { fields: ['license_plate'] },
  office: { fields: ['office__name'] },
  last_maintenance: { fields: ['last_maintenance'] },
  // "Overdue by" reads opposite to the date it derives from: the longest
  // overdue is the oldest service date, so ascending overdue is descending date.
  overdue: { fields: ['last_maintenance'], invert: true },
};

const COLUMNS: SortableColumn[] = [
  { key: 'index', label: 'No', width: '5%', align: 'center', sortable: false },
  { key: 'vehicle', label: 'Vehicle', width: '24%' },
  { key: 'license_plate', label: 'Plate', width: '15%' },
  { key: 'office', label: 'Office', width: '21%' },
  { key: 'last_maintenance', label: 'Last service', width: '17%' },
  { key: 'overdue', label: 'Overdue by', width: '18%' },
];

export default function NeedingMaintenancePage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  // Server-side, like the vehicle list: this table is paginated, so ordering
  // has to span the whole result set. Unsorted keeps the endpoint's own
  // "most overdue first" order.
  const [sort, setSort] = useState<SortState>(null);
  const ordering = toOrderingParam(sort, ORDERING_FIELDS);

  const toggleSort = (key: string) => {
    setSort((current) => nextSortState(current, key));
    setPage(1);
  };

  const overdue = useQuery({
    queryKey: queryKeys.needingMaintenancePage(page, ordering),
    queryFn: () => fetchVehiclesNeedingMaintenance(page, ordering),
    placeholderData: (previous) => previous,
  });

  const rows = overdue.data?.results ?? [];
  const total = overdue.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const neverServiced = rows.filter((row) => row.last_maintenance === null).length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h2">
          Needs service
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Active vehicles that have never been serviced, or whose last service was more than 365
          days ago. Most overdue first.
        </Typography>
      </Box>

      <Stack spacing={3}>
        {total > 0 ? (
          <Alert severity={neverServiced > 0 ? 'warning' : 'info'}>
            {total} {total === 1 ? 'vehicle needs' : 'vehicles need'} attention
            {neverServiced > 0
              ? ` - ${neverServiced} on this page ${
                  neverServiced === 1 ? 'has' : 'have'
                } never been serviced.`
              : '.'}
          </Alert>
        ) : null}

        <Paper variant="outlined">
          <QueryState
            isPending={overdue.isPending}
            isError={overdue.isError}
            error={overdue.error}
            onRetry={() => overdue.refetch()}
            isEmpty={rows.length === 0}
            emptyTitle="Everything is up to date"
            emptyMessage="No active vehicle is overdue for service."
            skeletonRows={PAGE_SIZE}
          >
            <TableContainer
              sx={{ opacity: overdue.isFetching ? 0.6 : 1, transition: 'opacity 120ms' }}
            >
              <Table sx={{ tableLayout: 'fixed', minWidth: 760 }}>
                <SortableTableHead columns={COLUMNS} sort={sort} onSort={toggleSort} />
                <TableBody>
                  {rows.map((vehicle, index) => (
                    <TableRow
                      key={vehicle.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => {
                        // Returns here, not to the vehicle list.
                        rememberReturnTo('Needs service');
                        router.push(`/vehicles/${vehicle.id}`);
                      }}
                    >
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
                      <TableCell sx={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
                        {vehicle.license_plate}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {vehicle.office?.name ?? '-'}
                      </TableCell>
                      <TableCell>{formatDate(vehicle.last_maintenance)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={vehicle.last_maintenance === null ? 'error' : 'warning'}
                          variant={vehicle.last_maintenance === null ? 'filled' : 'outlined'}
                          label={formatAge(vehicle.days_since_maintenance)}
                        />
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
    </Container>
  );
}
