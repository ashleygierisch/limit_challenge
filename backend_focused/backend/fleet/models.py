"""Domain models for the fleet maintenance API.

Index and constraint choices here are driven by the read patterns in
``fleet.views``; see the "Performance notes" section of the README.
"""

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def validate_model_year(value):
    """Reject model years that cannot correspond to a real vehicle.

    Implemented as a callable rather than a ``MaxValueValidator`` constant so
    the upper bound tracks the calendar without a migration every January.
    """
    ceiling = timezone.now().year + 1
    if value < 1900 or value > ceiling:
        raise ValidationError(
            f'Model year must be between 1900 and {ceiling}.',
            code='invalid_model_year',
        )


class Office(models.Model):
    name = models.CharField(max_length=120)
    city = models.CharField(max_length=120)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            # The pair is unique, not the name: "Central Depot" in two cities
            # is legitimate. Compared case-insensitively, because letting
            # "north depot" and "North Depot" coexist in one city would split
            # that office's vehicles across two rows in every report.
            models.UniqueConstraint(
                Lower('name'),
                Lower('city'),
                name='unique_office_name_and_city',
                violation_error_message=(
                    'An office with this name already exists in this city.'
                ),
            ),
        ]

    def __str__(self):
        return f'{self.name} ({self.city})'


class Mechanic(models.Model):
    name = models.CharField(max_length=120)
    # Treated as the mechanic's business identifier: vehicle search filters on
    # it directly, so it has to resolve to exactly one mechanic.
    certification_number = models.CharField(max_length=40, unique=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name', 'id']

    def __str__(self):
        return f'{self.name} ({self.certification_number})'


class Vehicle(models.Model):
    vin = models.CharField('VIN', max_length=17, unique=True)
    license_plate = models.CharField(max_length=16)
    make = models.CharField(max_length=60)
    model = models.CharField(max_length=60)
    year = models.PositiveSmallIntegerField(validators=[validate_model_year])
    office = models.ForeignKey(
        Office,
        on_delete=models.PROTECT,
        related_name='vehicles',
    )
    active = models.BooleanField(default=True)

    class Meta:
        # `vin` is unique, so it acts as the tiebreaker that keeps pagination
        # stable while still ordering the list the way a user reads it.
        ordering = ['make', 'model', 'vin']
        constraints = [
            # "A license plate cannot be shared by two active vehicles" -- a
            # plain unique=True would be wrong, since a plate is legitimately
            # reissued once the previous vehicle is retired.
            models.UniqueConstraint(
                fields=['license_plate'],
                condition=models.Q(active=True),
                name='unique_license_plate_among_active_vehicles',
            ),
        ]
        indexes = [
            models.Index(fields=['office', 'active'], name='vehicle_office_active_idx'),
            models.Index(fields=['make', 'model'], name='vehicle_make_model_idx'),
            models.Index(fields=['license_plate'], name='vehicle_plate_idx'),
        ]

    def __str__(self):
        return f'{self.year} {self.make} {self.model} ({self.vin})'


class MaintenanceRecord(models.Model):
    class MaintenanceType(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled service'
        REPAIR = 'repair', 'Repair'
        INSPECTION = 'inspection', 'Inspection'
        TIRE = 'tire', 'Tire service'
        OIL_CHANGE = 'oil_change', 'Oil change'
        EMERGENCY = 'emergency', 'Emergency callout'

    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.CASCADE,
        related_name='maintenance_records',
    )
    mechanic = models.ForeignKey(
        Mechanic,
        on_delete=models.PROTECT,
        related_name='maintenance_records',
    )
    # Caller-supplied: backdated records are normal when logging past work, so
    # this must never be auto_now_add.
    maintenance_date = models.DateField()
    maintenance_type = models.CharField(
        max_length=20,
        choices=MaintenanceType.choices,
    )
    cost = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-maintenance_date', '-id']
        indexes = [
            # Serves both the vehicle history endpoint and the per-vehicle
            # prefetch on vehicle detail, already in newest-first order.
            models.Index(
                fields=['vehicle', '-maintenance_date'],
                name='maint_vehicle_date_idx',
            ),
            # Mechanic workload: filter by year, group by mechanic.
            models.Index(
                fields=['mechanic', 'maintenance_date'],
                name='maint_mechanic_date_idx',
            ),
            # Office summary aggregates scan by date window first.
            models.Index(fields=['maintenance_date'], name='maint_date_idx'),
        ]

    def __str__(self):
        return f'{self.get_maintenance_type_display()} on {self.maintenance_date}'
