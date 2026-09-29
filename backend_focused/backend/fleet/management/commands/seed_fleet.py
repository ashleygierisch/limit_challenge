"""Populate the database with realistic dummy data for manual testing.

Beyond bulk volume, this deliberately plants the edge cases each reporting
endpoint is supposed to handle, so they can be exercised by hand immediately
after seeding rather than constructed by hand first. See ``--help`` output and
the summary printed at the end of a run.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from faker import Faker

from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle

MAKES = {
    'Ford': ['Transit', 'F-150', 'Ranger', 'Escape'],
    'Toyota': ['Hilux', 'Corolla', 'RAV4', 'Proace'],
    'Mercedes-Benz': ['Sprinter', 'Vito', 'Citan'],
    'Chevrolet': ['Silverado', 'Express', 'Colorado'],
    'Nissan': ['NV200', 'Navara', 'Leaf'],
}

MAINTENANCE_TYPES = [choice[0] for choice in MaintenanceRecord.MaintenanceType.choices]

# Rough cost band per maintenance type, in dollars.
COST_RANGES = {
    'scheduled': (180, 900),
    'repair': (300, 4200),
    'inspection': (90, 320),
    'tire': (200, 1400),
    'oil_change': (60, 180),
    'emergency': (500, 6500),
}


class Command(BaseCommand):
    help = (
        'Fill the database with dummy fleet data, including the edge cases '
        'the reporting endpoints are designed around.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--offices',
            type=int,
            default=6,
            help='Number of offices to create (default: 6).',
        )
        parser.add_argument(
            '--mechanics',
            type=int,
            default=12,
            help='Number of mechanics to create (default: 12).',
        )
        parser.add_argument(
            '--vehicles',
            type=int,
            default=80,
            help='Number of ordinary vehicles to create (default: 80).',
        )
        parser.add_argument(
            '--flush',
            action='store_true',
            help='Delete existing fleet data before seeding.',
        )
        parser.add_argument(
            '--seed',
            type=int,
            default=1234,
            help='Random seed, for reproducible data (default: 1234).',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        fake = Faker()
        Faker.seed(options['seed'])
        random.seed(options['seed'])

        if options['flush']:
            # Ordered child-first: offices and mechanics are PROTECTed.
            MaintenanceRecord.objects.all().delete()
            Vehicle.objects.all().delete()
            Office.objects.all().delete()
            Mechanic.objects.all().delete()
            self.stdout.write('Cleared existing fleet data.')

        today = timezone.localdate()

        offices = self._create_offices(fake, options['offices'])
        mechanics = self._create_mechanics(fake, options['mechanics'])
        vehicles = self._create_vehicles(fake, options['vehicles'], offices)

        records = []
        records += self._ordinary_history(vehicles, mechanics, today)

        notes = []
        notes += self._plant_heavy_history(fake, offices, mechanics, today, records)
        notes += self._plant_never_serviced(fake, offices)
        notes += self._plant_overdue(fake, offices, mechanics, today, records)
        notes += self._plant_reused_plate(fake, offices)
        notes += self._plant_boundary_records(vehicles, mechanics, today, records)

        # One round trip for what is typically several thousand rows.
        MaintenanceRecord.objects.bulk_create(records, batch_size=1000)

        self._report(offices, mechanics, records, notes)

    # -- bulk data ---------------------------------------------------------

    def _create_offices(self, fake, count):
        # fake.city() repeats, and (name, city) is unique case-insensitively,
        # so a plain call can collide and abort the whole seed. fake.unique
        # guarantees distinct cities, which makes each pair distinct too.
        offices = [
            Office(name=f'{city} Depot', city=city)
            for city in (fake.unique.city() for _ in range(count))
        ]
        return Office.objects.bulk_create(offices)

    def _create_mechanics(self, fake, count):
        mechanics = [
            Mechanic(
                name=fake.name(),
                certification_number=f'CERT-{2000 + index:04d}',
                # A few retired mechanics, so "active" is worth filtering on.
                active=index % 9 != 0,
            )
            for index in range(count)
        ]
        return Mechanic.objects.bulk_create(mechanics)

    def _create_vehicles(self, fake, count, offices):
        vehicles = []
        for index in range(count):
            make = random.choice(list(MAKES))
            vehicles.append(
                Vehicle(
                    vin=fake.unique.bothify('?#?#####?#?######').upper(),
                    license_plate=f'FLT-{index:04d}',
                    make=make,
                    model=random.choice(MAKES[make]),
                    year=random.randint(2012, today_year()),
                    office=random.choice(offices),
                    # Roughly one in eight retired, so active filters and the
                    # active-vehicle count are both meaningful.
                    active=index % 8 != 0,
                )
            )
        return Vehicle.objects.bulk_create(vehicles)

    def _ordinary_history(self, vehicles, mechanics, today):
        """Two to twenty records per vehicle, spread over the last ~3 years."""
        records = []
        for vehicle in vehicles:
            for _ in range(random.randint(2, 20)):
                records.append(
                    self._record(
                        vehicle,
                        random.choice(mechanics),
                        today - timedelta(days=random.randint(1, 1100)),
                    )
                )
        return records

    # -- planted edge cases ------------------------------------------------

    def _plant_heavy_history(self, fake, offices, mechanics, today, records):
        """A vehicle with 600 records, to exercise the detail endpoint.

        The README requires vehicle detail to stay fast with hundreds of
        maintenance records; this is the row that proves it.
        """
        vehicle = Vehicle.objects.create(
            vin=fake.unique.bothify('?#?#####?#?######').upper(),
            license_plate='HEAVY-01',
            make='Mercedes-Benz',
            model='Sprinter',
            year=2015,
            office=offices[0],
            active=True,
        )
        for _ in range(600):
            records.append(
                self._record(
                    vehicle,
                    random.choice(mechanics),
                    today - timedelta(days=random.randint(1, 3000)),
                )
            )
        return [f'Vehicle {vehicle.vin} ("HEAVY-01") has 600 maintenance records.']

    def _plant_never_serviced(self, fake, offices):
        """Active vehicles with no maintenance at all.

        These must appear first in "vehicles needing maintenance", which is the
        NULL-ordering case.
        """
        created = []
        for index in range(3):
            created.append(
                Vehicle.objects.create(
                    vin=fake.unique.bothify('?#?#####?#?######').upper(),
                    license_plate=f'NEW-{index:03d}',
                    make='Toyota',
                    model='Proace',
                    year=today_year(),
                    office=offices[index % len(offices)],
                    active=True,
                )
            )
        return [f'{len(created)} active vehicles have never been serviced.']

    def _plant_overdue(self, fake, offices, mechanics, today, records):
        """Active vehicles whose only service is well past the 365-day line."""
        created = []
        for index in range(4):
            vehicle = Vehicle.objects.create(
                vin=fake.unique.bothify('?#?#####?#?######').upper(),
                license_plate=f'OLD-{index:03d}',
                make='Ford',
                model='Transit',
                year=2013,
                office=offices[index % len(offices)],
                active=True,
            )
            records.append(
                self._record(
                    vehicle,
                    random.choice(mechanics),
                    today - timedelta(days=400 + index * 120),
                )
            )
            created.append(vehicle)
        return [f'{len(created)} active vehicles were last serviced 400+ days ago.']

    def _plant_reused_plate(self, fake, offices):
        """An inactive and an active vehicle sharing one license plate.

        Legal under the partial unique constraint -- a plate is reissued once
        the old vehicle is retired -- and the case a plain ``unique=True``
        would wrongly reject.
        """
        shared_plate = 'REUSE-99'
        Vehicle.objects.create(
            vin=fake.unique.bothify('?#?#####?#?######').upper(),
            license_plate=shared_plate,
            make='Nissan',
            model='NV200',
            year=2011,
            office=offices[0],
            active=False,
        )
        Vehicle.objects.create(
            vin=fake.unique.bothify('?#?#####?#?######').upper(),
            license_plate=shared_plate,
            make='Nissan',
            model='Leaf',
            year=2023,
            office=offices[0],
            active=True,
        )
        return [
            f'Plate "{shared_plate}" is shared by one retired and one active '
            f'vehicle (allowed); a second active vehicle on it is rejected.'
        ]

    def _plant_boundary_records(self, vehicles, mechanics, today, records):
        """Records straddling the 12-month and calendar-year boundaries.

        Office summary counts a rolling 12 months and mechanic workload counts
        the calendar year to date, so both boundaries need data on each side to
        be testable.
        """
        anchors = [
            today - timedelta(days=364),
            today - timedelta(days=366),
            today.replace(month=1, day=1),
            today.replace(month=1, day=1) - timedelta(days=1),
        ]
        target = vehicles[0]
        for anchor in anchors:
            records.append(self._record(target, mechanics[0], anchor))
        return [
            'Maintenance records sit on both sides of the 365-day and '
            'calendar-year boundaries.'
        ]

    # -- helpers -----------------------------------------------------------

    def _record(self, vehicle, mechanic, date):
        maintenance_type = random.choice(MAINTENANCE_TYPES)
        low, high = COST_RANGES[maintenance_type]
        return MaintenanceRecord(
            vehicle=vehicle,
            mechanic=mechanic,
            maintenance_date=date,
            maintenance_type=maintenance_type,
            cost=Decimal(random.randint(low * 100, high * 100)) / 100,
            notes='',
        )

    def _report(self, offices, mechanics, records, notes):
        self.stdout.write(
            self.style.SUCCESS(
                f'Seeded {len(offices)} offices, {len(mechanics)} mechanics, '
                f'{Vehicle.objects.count()} vehicles and {len(records)} '
                f'maintenance records.'
            )
        )
        self.stdout.write('\nPlanted edge cases:')
        for note in notes:
            self.stdout.write(f'  - {note}')


def today_year():
    return timezone.localdate().year
