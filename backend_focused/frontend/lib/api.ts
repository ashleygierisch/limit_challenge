/**
 * Typed wrappers around the fleet API.
 *
 * Every call goes through here rather than being spread across components, so
 * the URL surface and the query-parameter names live in one place next to the
 * types they return.
 */

import { AxiosError } from 'axios';

import { apiClient } from './api-client';
import type {
  DuplicateCheck,
  MaintenanceRecord,
  MaintenanceRecordWriteInput,
  Mechanic,
  Office,
  OfficeSummary,
  Paginated,
  MechanicWorkload,
  Vehicle,
  VehicleDetail,
  VehicleFilters,
  VehicleNeedingMaintenance,
  VehicleWriteInput,
} from './types';

/**
 * Collect every page of a paginated endpoint.
 *
 * For the small, bounded reference lists that feed dropdowns, where a dedicated
 * unpaginated endpoint would not earn its keep.
 */
async function fetchAllPages<T>(page: (n: number) => Promise<Paginated<T>>): Promise<T[]> {
  const collected: T[] = [];
  for (let n = 1; ; n += 1) {
    const data = await page(n);
    collected.push(...data.results);
    if (!data.next) return collected;
  }
}

/** Rows per page; must match REST_FRAMEWORK['PAGE_SIZE'] in the backend. */
export const PAGE_SIZE = 10;

/** Drop blank values so an untouched filter never reaches the API. */
function pruned(params: Record<string, string | number | undefined>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== '' && value !== undefined),
  );
}

// -- offices ----------------------------------------------------------------

export async function fetchOffices(page = 1) {
  const { data } = await apiClient.get<Paginated<Office>>('/offices/', {
    params: { page },
  });
  return data;
}

/** Every office, following pagination - for filter dropdowns. */
export function fetchAllOffices() {
  return fetchAllPages(fetchOffices);
}

export async function createOffice(input: Omit<Office, 'id'>) {
  const { data } = await apiClient.post<Office>('/offices/', input);
  return data;
}

export async function updateOffice(id: number, input: Partial<Omit<Office, 'id'>>) {
  const { data } = await apiClient.patch<Office>(`/offices/${id}/`, input);
  return data;
}

export async function deleteOffice(id: number) {
  await apiClient.delete(`/offices/${id}/`);
}

export async function fetchOfficeSummary() {
  const { data } = await apiClient.get<OfficeSummary[]>('/offices/summary/');
  return data;
}

// -- mechanics --------------------------------------------------------------

export async function fetchMechanics(page = 1) {
  const { data } = await apiClient.get<Paginated<Mechanic>>('/mechanics/', {
    params: { page },
  });
  return data;
}

export function fetchAllMechanics() {
  return fetchAllPages(fetchMechanics);
}

/** The mechanic workload report, which the API returns unpaginated. */
export async function fetchMechanicWorkload() {
  const { data } = await apiClient.get<MechanicWorkload[]>('/mechanics/workload/');
  return data;
}

export async function createMechanic(input: Omit<Mechanic, 'id'>) {
  const { data } = await apiClient.post<Mechanic>('/mechanics/', input);
  return data;
}

export async function updateMechanic(id: number, input: Partial<Omit<Mechanic, 'id'>>) {
  const { data } = await apiClient.patch<Mechanic>(`/mechanics/${id}/`, input);
  return data;
}

export async function deleteMechanic(id: number) {
  await apiClient.delete(`/mechanics/${id}/`);
}

// -- vehicles ---------------------------------------------------------------

export async function searchVehicles(filters: VehicleFilters, page: number, ordering = '') {
  const { data } = await apiClient.get<Paginated<Vehicle>>('/vehicles/', {
    params: pruned({ ...filters, page, ordering }),
  });
  return data;
}

export async function fetchVehicle(id: number) {
  const { data } = await apiClient.get<VehicleDetail>(`/vehicles/${id}/`);
  return data;
}

export async function createVehicle(input: VehicleWriteInput) {
  const { data } = await apiClient.post<Vehicle>('/vehicles/', input);
  return data;
}

export async function updateVehicle(id: number, input: Partial<VehicleWriteInput>) {
  const { data } = await apiClient.patch<Vehicle>(`/vehicles/${id}/`, input);
  return data;
}

export async function deleteVehicle(id: number) {
  await apiClient.delete(`/vehicles/${id}/`);
}

export async function assignVehicle(id: number, office: number) {
  const { data } = await apiClient.post<Vehicle>(`/vehicles/${id}/assign/`, {
    office,
  });
  return data;
}

export async function fetchVehiclesNeedingMaintenance(page = 1, ordering = '') {
  const { data } = await apiClient.get<Paginated<VehicleNeedingMaintenance>>(
    '/vehicles/needing-maintenance/',
    { params: pruned({ page, ordering }) },
  );
  return data;
}

export async function checkDuplicate(params: {
  vin?: string;
  license_plate?: string;
  exclude_id?: number;
}) {
  const { data } = await apiClient.get<DuplicateCheck>('/vehicles/check-duplicate/', {
    params: pruned(params),
  });
  return data;
}

// -- maintenance records ----------------------------------------------------

export async function createMaintenanceRecord(input: MaintenanceRecordWriteInput) {
  const { data } = await apiClient.post<MaintenanceRecord>('/maintenance-records/', input);
  return data;
}

export async function updateMaintenanceRecord(
  id: number,
  input: Partial<MaintenanceRecordWriteInput>,
) {
  const { data } = await apiClient.patch<MaintenanceRecord>(`/maintenance-records/${id}/`, input);
  return data;
}

export async function deleteMaintenanceRecord(id: number) {
  await apiClient.delete(`/maintenance-records/${id}/`);
}

// -- error helpers ----------------------------------------------------------

/** Field-keyed validation errors, as DRF returns them on a 400. */
export type FieldErrors = Record<string, string[]>;

const NON_FIELD = '__all__';

/**
 * Split a failed request into per-field messages and one summary message.
 *
 * DRF returns `{"field": ["message"]}` for validation errors and
 * `{"detail": "..."}` for everything else, so a form can show the former
 * inline and fall back to the latter for conflicts and server faults.
 */
export function parseApiError(error: unknown): {
  fieldErrors: FieldErrors;
  message: string;
} {
  if (!(error instanceof AxiosError)) {
    return { fieldErrors: {}, message: 'Something went wrong. Please try again.' };
  }

  if (!error.response) {
    return {
      fieldErrors: {},
      message:
        'Could not reach the API. Check that the Django server is running on ' +
        (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api') +
        '.',
    };
  }

  const { status, data } = error.response;

  if (status >= 500) {
    return { fieldErrors: {}, message: `Server error (${status}). Please try again.` };
  }

  if (typeof data === 'string') {
    return { fieldErrors: {}, message: data };
  }

  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;

    if (typeof body.detail === 'string') {
      return { fieldErrors: {}, message: body.detail };
    }

    const fieldErrors: FieldErrors = {};
    for (const [field, value] of Object.entries(body)) {
      const messages = Array.isArray(value) ? value.map(String) : [String(value)];
      fieldErrors[field === 'non_field_errors' ? NON_FIELD : field] = messages;
    }

    const summary =
      fieldErrors[NON_FIELD]?.join(' ') ?? 'Please correct the highlighted fields and try again.';

    return { fieldErrors, message: summary };
  }

  return { fieldErrors: {}, message: `Request failed (${status}).` };
}
