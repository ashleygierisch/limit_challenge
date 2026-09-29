"""API views for the fleet maintenance service.

Views stay thin: query construction lives in ``fleet.queries`` and shaping
lives in ``fleet.serializers``. Each viewset selects its queryset per action so
that a cheap list endpoint never pays for the joins a detail endpoint needs.
"""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from fleet import queries
from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle
from fleet.ordering import FleetOrderingFilter
from fleet.serializers import (
    AssignVehicleSerializer,
    DuplicateCheckSerializer,
    MaintenanceRecordSerializer,
    MechanicSerializer,
    MechanicWorkloadSerializer,
    OfficeSerializer,
    OfficeSummarySerializer,
    VehicleDetailSerializer,
    VehicleMaintenanceRecordSerializer,
    VehicleNeedingMaintenanceSerializer,
    VehicleSearchSerializer,
    VehicleSerializer,
)


class OfficeViewSet(viewsets.ModelViewSet):
    """CRUD for offices, plus the cross-office summary report."""

    queryset = Office.objects.all()
    serializer_class = OfficeSerializer

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Every office with active vehicles, 12-month spend and last service.

        Returned unpaginated: this is a bounded report over the office roster,
        and it is meant to be read as a whole.
        """
        serializer = OfficeSummarySerializer(
            queries.office_summary_queryset(),
            many=True,
            context={'window': queries.rolling_year_window()},
        )
        return Response(serializer.data)


class MechanicViewSet(viewsets.ModelViewSet):
    """CRUD for mechanics, plus the year-to-date workload report."""

    queryset = Mechanic.objects.all()
    serializer_class = MechanicSerializer

    @action(detail=False, methods=['get'])
    def workload(self, request):
        """Mechanics ranked busiest first for the current calendar year."""
        workload = queries.mechanic_workload_queryset()
        serializer = MechanicWorkloadSerializer(workload, many=True)
        return Response(serializer.data)


class VehicleViewSet(viewsets.ModelViewSet):
    """CRUD and search for vehicles, plus history, assignment and dedupe."""

    serializer_class = VehicleSerializer
    filter_backends = [FleetOrderingFilter]
    # VIN is unique, so it resolves ties and keeps pagination stable when the
    # requested column has duplicate values.
    ordering_tiebreaker = 'vin'

    # Sortable columns, whitelisted per action. Anything else is ignored rather
    # than passed through to order_by, which would otherwise let a caller order
    # by arbitrary related fields.
    LIST_ORDERING_FIELDS = [
        'vin',
        'license_plate',
        'make',
        'model',
        'year',
        'active',
        'office__name',
    ]
    OVERDUE_ORDERING_FIELDS = [
        'vin',
        'license_plate',
        'make',
        'model',
        'year',
        'office__name',
        # Annotated by the queryset, not a model field.
        'last_maintenance',
    ]

    @property
    def ordering_fields(self):
        if self.action == 'needing_maintenance':
            return self.OVERDUE_ORDERING_FIELDS
        return self.LIST_ORDERING_FIELDS

    def get_queryset(self):
        if self.action == 'list':
            # Query parameters are validated rather than read raw, so a
            # malformed filter is a 400 instead of a silently ignored filter.
            search = VehicleSearchSerializer(data=self.request.query_params)
            search.is_valid(raise_exception=True)
            return queries.search_vehicles(search.validated_data)

        if self.action == 'retrieve':
            return queries.vehicle_detail_queryset()

        if self.action == 'needing_maintenance':
            return queries.vehicles_needing_maintenance_queryset()

        return Vehicle.objects.select_related('office')

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return VehicleDetailSerializer
        if self.action == 'needing_maintenance':
            return VehicleNeedingMaintenanceSerializer
        return VehicleSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Pinned once per request so every row in a response is measured
        # against the same date.
        context['today'] = timezone.localdate()
        return context

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """Maintenance history for one vehicle, newest first."""
        vehicle = get_object_or_404(Vehicle, pk=pk)
        history = queries.vehicle_history_queryset(vehicle.pk)

        page = self.paginate_queryset(history)
        if page is not None:
            serializer = VehicleMaintenanceRecordSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = VehicleMaintenanceRecordSerializer(history, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        """Move a vehicle to a different office.

        Records only the new assignment: the vehicle's ``office`` is updated
        and nothing else about the vehicle changes. See the README assumptions
        for why no assignment history table is kept.
        """
        vehicle = get_object_or_404(Vehicle, pk=pk)
        serializer = AssignVehicleSerializer(
            data=request.data,
            context={'vehicle': vehicle},
        )
        serializer.is_valid(raise_exception=True)

        vehicle.office = serializer.validated_data['office']
        # update_fields keeps this a single-column write and cannot clobber a
        # concurrent edit to any other field.
        vehicle.save(update_fields=['office'])

        return Response(
            VehicleSerializer(vehicle, context=self.get_serializer_context()).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['get'], url_path='needing-maintenance')
    def needing_maintenance(self, request):
        """Active vehicles never serviced, or last serviced over 365 days ago.

        Ordered most overdue first, with never-serviced vehicles at the top.
        ``get_queryset`` and ``get_serializer_class`` already branch on the
        action, so the standard list implementation does the rest.
        """
        return self.list(request)

    @action(detail=False, methods=['get'], url_path='check-duplicate')
    def check_duplicate(self, request):
        """Report which of VIN / license plate already belong to a vehicle."""
        serializer = DuplicateCheckSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)

        conflicts = queries.find_vehicle_conflicts(**serializer.validated_data)
        return Response({'conflicts': conflicts})


class MaintenanceRecordViewSet(viewsets.ModelViewSet):
    """CRUD for maintenance records."""

    serializer_class = MaintenanceRecordSerializer

    def get_queryset(self):
        # The nested mechanic would otherwise cost one query per row. `vehicle`
        # is serialized as a primary key, so it needs no join.
        queryset = MaintenanceRecord.objects.select_related('mechanic')

        vehicle_id = self.request.query_params.get('vehicle')
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)

        return queryset
