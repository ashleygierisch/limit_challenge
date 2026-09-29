"""Model-level constraint tests.

These assert at the database layer, not through the API, because a constraint
that only exists in serializer code is not a constraint -- it can be bypassed
by the admin, a management command or a shell.
"""

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from fleet.models import Office
from fleet.tests.factories import make_office, make_vehicle


class LicensePlateConstraintTests(TestCase):
    """The plate is unique only among *active* vehicles."""

    def setUp(self):
        self.office = make_office()

    def test_two_active_vehicles_cannot_share_a_plate(self):
        make_vehicle(office=self.office, license_plate='SHARED-1', active=True)

        with self.assertRaises(IntegrityError), transaction.atomic():
            make_vehicle(office=self.office, license_plate='SHARED-1', active=True)

    def test_active_and_inactive_vehicle_may_share_a_plate(self):
        """A plate is reissued once the previous vehicle is retired."""
        make_vehicle(office=self.office, license_plate='SHARED-2', active=False)
        make_vehicle(office=self.office, license_plate='SHARED-2', active=True)

        self.assertEqual(
            2,
            self.office.vehicles.filter(license_plate='SHARED-2').count(),
        )

    def test_two_inactive_vehicles_may_share_a_plate(self):
        make_vehicle(office=self.office, license_plate='SHARED-3', active=False)
        make_vehicle(office=self.office, license_plate='SHARED-3', active=False)

        self.assertEqual(
            2,
            self.office.vehicles.filter(license_plate='SHARED-3').count(),
        )

    def test_retiring_a_vehicle_frees_its_plate(self):
        first = make_vehicle(office=self.office, license_plate='SHARED-4', active=True)
        first.active = False
        first.save(update_fields=['active'])

        make_vehicle(office=self.office, license_plate='SHARED-4', active=True)

        self.assertEqual(
            1,
            self.office.vehicles.filter(
                license_plate='SHARED-4', active=True
            ).count(),
        )


class VinConstraintTests(TestCase):
    def test_vin_is_globally_unique(self):
        """Unlike the plate, a VIN identifies the physical vehicle forever."""
        make_vehicle(vin='DUPLICATEVIN00001', active=True)

        with self.assertRaises(IntegrityError), transaction.atomic():
            make_vehicle(vin='DUPLICATEVIN00001', active=False)


class ModelYearValidationTests(TestCase):
    def test_year_in_the_far_future_is_rejected(self):
        vehicle = make_vehicle()
        vehicle.year = 3000

        with self.assertRaises(ValidationError) as caught:
            vehicle.full_clean()

        self.assertIn('year', caught.exception.error_dict)

    def test_year_before_motoring_is_rejected(self):
        vehicle = make_vehicle()
        vehicle.year = 1800

        with self.assertRaises(ValidationError) as caught:
            vehicle.full_clean()

        self.assertIn('year', caught.exception.error_dict)


class OfficeUniquenessTests(TestCase):
    """An office is identified by its name within a city."""

    def test_same_name_and_city_is_rejected(self):
        make_office(name='Central Depot', city='Springfield')

        with self.assertRaises(IntegrityError), transaction.atomic():
            make_office(name='Central Depot', city='Springfield')

    def test_comparison_is_case_insensitive(self):
        """Letting case-variants coexist would split one office's vehicles."""
        make_office(name='Central Depot', city='Springfield')

        with self.assertRaises(IntegrityError), transaction.atomic():
            make_office(name='central depot', city='SPRINGFIELD')

    def test_same_name_in_a_different_city_is_allowed(self):
        make_office(name='Central Depot', city='Springfield')
        make_office(name='Central Depot', city='Shelbyville')

        self.assertEqual(2, Office.objects.filter(name='Central Depot').count())

    def test_different_name_in_the_same_city_is_allowed(self):
        make_office(name='North Depot', city='Springfield')
        make_office(name='South Depot', city='Springfield')

        self.assertEqual(2, Office.objects.filter(city='Springfield').count())
