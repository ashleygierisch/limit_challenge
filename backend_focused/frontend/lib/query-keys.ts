/**
 * Central registry of react-query cache keys.
 *
 * Keys are declared once so that invalidating after a mutation cannot drift
 * out of sync with the keys the queries actually use - the usual cause of a
 * table that silently shows stale rows after an edit.
 */

import type { QueryClient } from '@tanstack/react-query';

import type { VehicleFilters } from './types';

export const queryKeys = {
  offices: ['offices'] as const,
  allOffices: ['offices', 'all'] as const,
  officeSummary: ['offices', 'summary'] as const,

  mechanics: ['mechanics'] as const,
  allMechanics: ['mechanics', 'all'] as const,
  mechanicWorkload: ['mechanics', 'workload'] as const,

  vehicles: ['vehicles'] as const,
  vehicleSearch: (filters: VehicleFilters, page: number, ordering: string) =>
    ['vehicles', 'search', filters, page, ordering] as const,
  vehicle: (id: number) => ['vehicles', 'detail', id] as const,
  needingMaintenance: ['vehicles', 'needing-maintenance'] as const,
  needingMaintenancePage: (page: number, ordering: string) =>
    ['vehicles', 'needing-maintenance', page, ordering] as const,
  duplicateCheck: (vin: string, plate: string, excludeId?: number) =>
    ['vehicles', 'duplicate-check', vin, plate, excludeId ?? null] as const,
};

/**
 * Refresh everything a change to vehicles or maintenance affects.
 *
 * Declared once because the fan-out is easy to get wrong: a maintenance record
 * feeds the vehicle's own totals, the office spend report, the mechanic's
 * workload and whether the vehicle counts as overdue. Deleting a vehicle
 * cascades its records, so it moves the same four.
 */
export function invalidateFleetData(queryClient: QueryClient) {
  for (const queryKey of [
    queryKeys.vehicles,
    queryKeys.officeSummary,
    queryKeys.mechanicWorkload,
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}
