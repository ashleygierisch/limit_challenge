"""Admin registration.

Not required by the brief, but it makes the seeded data browsable while
developing, and the search/filter setup costs almost nothing.
"""

from django.contrib import admin

from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle


@admin.register(Office)
class OfficeAdmin(admin.ModelAdmin):
    list_display = ['name', 'city']
    search_fields = ['name', 'city']


@admin.register(Mechanic)
class MechanicAdmin(admin.ModelAdmin):
    list_display = ['name', 'certification_number', 'active']
    list_filter = ['active']
    search_fields = ['name', 'certification_number']


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ['vin', 'license_plate', 'make', 'model', 'year', 'office', 'active']
    list_filter = ['active', 'office', 'make']
    search_fields = ['vin', 'license_plate']
    list_select_related = ['office']


@admin.register(MaintenanceRecord)
class MaintenanceRecordAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'mechanic', 'maintenance_date', 'maintenance_type', 'cost']
    list_filter = ['maintenance_type', 'maintenance_date']
    search_fields = ['vehicle__vin', 'vehicle__license_plate', 'mechanic__name']
    list_select_related = ['vehicle', 'mechanic']
    date_hierarchy = 'maintenance_date'
