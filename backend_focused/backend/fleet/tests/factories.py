"""Small hand-rolled builders for test fixtures.

Deliberately not factory_boy: the models are simple enough that plain helpers
with sensible defaults are easier to read than a factory DSL, and they add no
dependency.
"""

import itertools
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle

_vin_counter = itertools.count(1)
_plate_counter = itertools.count(1)
_cert_counter = itertools.count(1)
_office_counter = itertools.count(1)


def today():
    return timezone.localdate()


def days_ago(count):
    return today() - timedelta(days=count)


def make_office(name=None, city='Springfield'):
    """Create an office, with a unique default name.

    (name, city) is unique case-insensitively, so the default has to vary --
    otherwise any test that creates two offices incidentally (two vehicles, say)
    would trip the constraint rather than testing what it meant to.
    """
    if name is None:
        name = f'Depot {next(_office_counter)}'
    return Office.objects.create(name=name, city=city)


def make_mechanic(name='Sam Mechanic', certification_number=None, active=True):
    if certification_number is None:
        certification_number = f'CERT-{next(_cert_counter):05d}'
    return Mechanic.objects.create(
        name=name,
        certification_number=certification_number,
        active=active,
    )


def make_vehicle(
    office=None,
    vin=None,
    license_plate=None,
    make='Ford',
    model='Transit',
    year=2020,
    active=True,
):
    return Vehicle.objects.create(
        vin=vin or f'VIN{next(_vin_counter):014d}',
        license_plate=license_plate or f'PLATE-{next(_plate_counter):05d}',
        make=make,
        model=model,
        year=year,
        office=office or make_office(),
        active=active,
    )


def make_record(
    vehicle,
    mechanic=None,
    maintenance_date=None,
    maintenance_type=MaintenanceRecord.MaintenanceType.REPAIR,
    cost='100.00',
    notes='',
):
    return MaintenanceRecord.objects.create(
        vehicle=vehicle,
        mechanic=mechanic or make_mechanic(),
        maintenance_date=maintenance_date or days_ago(10),
        maintenance_type=maintenance_type,
        cost=Decimal(cost),
        notes=notes,
    )


def results(response):
    """Return the rows from a response, paginated or not."""
    data = response.json()
    if isinstance(data, dict) and 'results' in data:
        return data['results']
    return data
