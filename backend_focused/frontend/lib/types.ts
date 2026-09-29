/** Shapes returned by the fleet API. Mirrors `backend/fleet/serializers.py`. */

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Office {
  id: number;
  name: string;
  city: string;
}

export interface Mechanic {
  id: number;
  name: string;
  certification_number: string;
  active: boolean;
}

export interface Vehicle {
  id: number;
  vin: string;
  license_plate: string;
  make: string;
  model: string;
  year: number;
  office: number;
  office_detail: Office;
  active: boolean;
}

export interface MaintenanceRecord {
  id: number;
  vehicle: number;
  mechanic: number;
  mechanic_detail: Mechanic;
  maintenance_date: string;
  maintenance_type: MaintenanceType;
  maintenance_type_display: string;
  cost: string;
  notes: string;
}

/** A maintenance record as nested inside a vehicle payload. */
export interface VehicleMaintenanceRecord {
  id: number;
  mechanic: Mechanic;
  maintenance_date: string;
  maintenance_type: MaintenanceType;
  maintenance_type_display: string;
  cost: string;
  notes: string;
}

export interface VehicleDetail {
  id: number;
  vin: string;
  license_plate: string;
  make: string;
  model: string;
  year: number;
  active: boolean;
  office: Office;
  maintenance_count: number;
  total_maintenance_cost: string;
  maintenance_records: VehicleMaintenanceRecord[];
}

export interface OfficeSummary {
  id: number;
  name: string;
  city: string;
  active_vehicle_count: number;
  maintenance_cost_last_year: string;
  /** The window that figure covers, as the API computed it. */
  maintenance_window_start: string;
  maintenance_window_end: string;
  last_maintenance: string | null;
}

export interface MechanicWorkload {
  id: number;
  name: string;
  certification_number: string;
  active: boolean;
  records_this_year: number;
  cost_this_year: string;
}

export interface VehicleNeedingMaintenance {
  id: number;
  vin: string;
  license_plate: string;
  make: string;
  model: string;
  year: number;
  office: Office;
  last_maintenance: string | null;
  days_since_maintenance: number | null;
}

export interface DuplicateCheck {
  conflicts: Array<'vin' | 'license_plate'>;
}

export type MaintenanceType =
  | 'scheduled'
  | 'repair'
  | 'inspection'
  | 'tire'
  | 'oil_change'
  | 'emergency';

export const MAINTENANCE_TYPES: Array<{ value: MaintenanceType; label: string }> = [
  { value: 'scheduled', label: 'Scheduled service' },
  { value: 'repair', label: 'Repair' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'tire', label: 'Tire service' },
  { value: 'oil_change', label: 'Oil change' },
  { value: 'emergency', label: 'Emergency callout' },
];

/** Query parameters accepted by the vehicle search endpoint. */
export interface VehicleFilters {
  office: string;
  active: string;
  make: string;
  model: string;
  maintained_from: string;
  maintained_to: string;
  certification_number: string;
}

export type VehicleWriteInput = {
  vin: string;
  license_plate: string;
  make: string;
  model: string;
  year: number | string;
  office: number | string;
  active: boolean;
};

export type MaintenanceRecordWriteInput = {
  vehicle: number;
  mechanic: number | string;
  maintenance_date: string;
  maintenance_type: MaintenanceType;
  cost: string;
  notes: string;
};
