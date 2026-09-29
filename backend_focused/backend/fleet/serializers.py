"""Serializers for the fleet maintenance API.

Read-heavy endpoints use dedicated serializers that only touch fields already
loaded by the view's queryset, so a nested representation never triggers an
extra query per row.
"""

from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from fleet import queries
from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle


class OfficeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Office
        fields = ['id', 'name', 'city']

    def validate_name(self, value):
        # Trim before comparing, or "North " and "North" become two offices
        # that the case-insensitive database constraint still treats as
        # distinct.
        return value.strip()

    def validate_city(self, value):
        return value.strip()

    def validate(self, attrs):
        """Reject an office that duplicates an existing name/city pair.

        DRF derives validators only from unconditional ``UniqueConstraint``s
        over plain field lists; the constraint here is built from ``Lower()``
        expressions, so nothing is generated for it and the database would
        raise ``IntegrityError`` -- a 500 -- instead of a field-level 400.

        ``self.instance`` is excluded so that re-saving an office without
        renaming it, or editing only its city, does not report the office as
        its own duplicate.
        """
        instance = self.instance
        name = attrs.get('name', getattr(instance, 'name', None))
        city = attrs.get('city', getattr(instance, 'city', None))

        if name and city:
            clash = Office.objects.filter(name__iexact=name, city__iexact=city)
            if instance is not None:
                clash = clash.exclude(pk=instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {
                        'name': [
                            f'An office named "{name}" already exists in '
                            f'{city}. Use a different name, or edit the '
                            f'existing office instead.'
                        ]
                    }
                )
        return attrs


class MechanicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Mechanic
        fields = ['id', 'name', 'certification_number', 'active']


class VehicleSerializer(serializers.ModelSerializer):
    """CRUD serializer for vehicles.

    ``office`` is written by id and echoed back as a nested object so the
    frontend can render a row without a second request.
    """

    office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.all())
    office_detail = OfficeSerializer(source='office', read_only=True)
    # Declared explicitly to drop the UniqueValidator DRF derives from the
    # partial UniqueConstraint. That validator scopes the *existing* rows to
    # active=True correctly, but applies unconditionally -- so it rejects
    # registering a retired vehicle on a plate an active vehicle still holds,
    # which the database permits. validate() below handles both sides.
    license_plate = serializers.CharField(max_length=16, validators=[])

    class Meta:
        model = Vehicle
        fields = [
            'id',
            'vin',
            'license_plate',
            'make',
            'model',
            'year',
            'office',
            'office_detail',
            'active',
        ]

    def validate_vin(self, value):
        return value.strip().upper()

    def validate_license_plate(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        """Enforce the partial unique constraint on license plate.

        Delegates to the same helper the duplicate-check endpoint uses, so the
        live hint in the form and the rejection on save cannot disagree.
        """
        instance = self.instance
        plate = attrs.get('license_plate', getattr(instance, 'license_plate', None))
        active = attrs.get('active', getattr(instance, 'active', True))

        # The constraint only restricts active rows, so a vehicle being saved
        # as retired can take a plate an active vehicle holds.
        if active and plate:
            conflicts = queries.find_vehicle_conflicts(
                license_plate=plate,
                exclude_id=getattr(instance, 'pk', None),
            )
            if 'license_plate' in conflicts:
                raise serializers.ValidationError(
                    {
                        'license_plate': [
                            'Another active vehicle already uses this license '
                            'plate. Deactivate that vehicle first, or record '
                            'this one as inactive.'
                        ]
                    }
                )
        return attrs


class MaintenanceRecordSerializer(serializers.ModelSerializer):
    """CRUD serializer for maintenance records."""

    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    mechanic = serializers.PrimaryKeyRelatedField(queryset=Mechanic.objects.all())
    mechanic_detail = MechanicSerializer(source='mechanic', read_only=True)
    maintenance_type_display = serializers.CharField(
        source='get_maintenance_type_display',
        read_only=True,
    )

    class Meta:
        model = MaintenanceRecord
        fields = [
            'id',
            'vehicle',
            'mechanic',
            'mechanic_detail',
            'maintenance_date',
            'maintenance_type',
            'maintenance_type_display',
            'cost',
            'notes',
        ]

    def validate_maintenance_date(self, value):
        # A record documents work already performed, so a future date is a
        # data-entry error rather than a scheduled job.
        if value > timezone.localdate():
            raise serializers.ValidationError(
                'Maintenance date cannot be in the future.'
            )
        return value


class VehicleMaintenanceRecordSerializer(serializers.ModelSerializer):
    """Maintenance row as nested inside a vehicle payload.

    Drops ``vehicle`` (implied by the parent) and reads the mechanic from the
    prefetch, so rendering N records costs no additional queries.
    """

    mechanic = MechanicSerializer(read_only=True)
    maintenance_type_display = serializers.CharField(
        source='get_maintenance_type_display',
        read_only=True,
    )

    class Meta:
        model = MaintenanceRecord
        fields = [
            'id',
            'mechanic',
            'maintenance_date',
            'maintenance_type',
            'maintenance_type_display',
            'cost',
            'notes',
        ]


class VehicleDetailSerializer(serializers.ModelSerializer):
    """Vehicle plus office and full maintenance history.

    ``maintenance_records`` is read from a prefetch configured in the view; the
    source attribute must match that prefetch's ``to_attr``.
    """

    office = OfficeSerializer(read_only=True)
    maintenance_records = VehicleMaintenanceRecordSerializer(
        many=True,
        read_only=True,
        source='prefetched_maintenance',
    )
    # Derived from the prefetched rows rather than annotated on the queryset,
    # which would re-read the whole history just to produce these two numbers.
    maintenance_count = serializers.SerializerMethodField()
    total_maintenance_cost = serializers.SerializerMethodField()

    def get_maintenance_count(self, obj):
        return len(obj.prefetched_maintenance)

    def get_total_maintenance_cost(self, obj):
        total = sum((record.cost for record in obj.prefetched_maintenance), Decimal('0.00'))
        return f'{total:.2f}'

    class Meta:
        model = Vehicle
        fields = [
            'id',
            'vin',
            'license_plate',
            'make',
            'model',
            'year',
            'active',
            'office',
            'maintenance_count',
            'total_maintenance_cost',
            'maintenance_records',
        ]


class OfficeSummarySerializer(serializers.Serializer):
    """Read-only projection of the annotated office summary queryset."""

    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)
    city = serializers.CharField(read_only=True)
    active_vehicle_count = serializers.IntegerField(read_only=True)
    # Published so a client linking to "the vehicles behind this figure" uses
    # exactly the window the figure was summed over.
    maintenance_window_start = serializers.SerializerMethodField()
    maintenance_window_end = serializers.SerializerMethodField()

    def get_maintenance_window_start(self, obj):
        return self.context['window'][0]

    def get_maintenance_window_end(self, obj):
        return self.context['window'][1]

    maintenance_cost_last_year = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        read_only=True,
    )
    last_maintenance = serializers.DateField(read_only=True)


class MechanicWorkloadSerializer(serializers.Serializer):
    """Read-only projection of the annotated mechanic workload queryset.

    Carries ``active`` so the report is self-sufficient. Without it a client
    showing status alongside workload has to fetch the roster separately and
    join the two by id, which costs a second request and leaves rows
    half-rendered until it lands.
    """

    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)
    certification_number = serializers.CharField(read_only=True)
    active = serializers.BooleanField(read_only=True)
    records_this_year = serializers.IntegerField(read_only=True)
    cost_this_year = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        read_only=True,
    )


class VehicleNeedingMaintenanceSerializer(serializers.ModelSerializer):
    """Overdue vehicle row, annotated with its last service date."""

    office = OfficeSerializer(read_only=True)
    last_maintenance = serializers.DateField(read_only=True, allow_null=True)
    days_since_maintenance = serializers.SerializerMethodField()

    def get_days_since_maintenance(self, obj):
        """Days since the last service, or ``None`` if never serviced.

        Derived in Python from a value the queryset already annotated, so it
        costs no extra query and avoids date arithmetic that behaves
        differently across database backends.
        """
        last = getattr(obj, 'last_maintenance', None)
        if last is None:
            return None
        return (self.context['today'] - last).days

    class Meta:
        model = Vehicle
        fields = [
            'id',
            'vin',
            'license_plate',
            'make',
            'model',
            'year',
            'office',
            'last_maintenance',
            'days_since_maintenance',
        ]


class VehicleSearchSerializer(serializers.Serializer):
    """Validates vehicle search query parameters.

    Validating rather than reading ``request.query_params`` directly means a
    malformed filter (``?active=maybe``, ``?office=abc``) returns a 400 naming
    the bad parameter, instead of being silently dropped and returning results
    the caller did not ask for.
    """

    office = serializers.PrimaryKeyRelatedField(
        queryset=Office.objects.all(),
        required=False,
    )
    active = serializers.BooleanField(required=False, allow_null=True, default=None)
    make = serializers.CharField(required=False, allow_blank=True)
    model = serializers.CharField(required=False, allow_blank=True)
    maintained_from = serializers.DateField(required=False)
    maintained_to = serializers.DateField(required=False)
    certification_number = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        start = attrs.get('maintained_from')
        end = attrs.get('maintained_to')
        if start and end and start > end:
            raise serializers.ValidationError(
                {'maintained_to': ['Must not be earlier than "maintained_from".']}
            )
        return attrs


class AssignVehicleSerializer(serializers.Serializer):
    """Input for moving a vehicle to a different office."""

    office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.all())

    def validate_office(self, value):
        vehicle = self.context['vehicle']
        if vehicle.office_id == value.pk:
            raise serializers.ValidationError(
                'This vehicle is already assigned to that office.'
            )
        return value


class DuplicateCheckSerializer(serializers.Serializer):
    """Query input for the duplicate vehicle check."""

    vin = serializers.CharField(required=False, allow_blank=True)
    license_plate = serializers.CharField(required=False, allow_blank=True)
    # Lets an edit form check itself without self-reporting a conflict.
    exclude_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if not attrs.get('vin') and not attrs.get('license_plate'):
            raise serializers.ValidationError(
                'Provide at least one of "vin" or "license_plate".'
            )
        return attrs
