"""Vehicle search filter tests."""

from django.urls import reverse
from rest_framework import status
from fleet.tests.base import AuthenticatedAPITestCase

from fleet.tests.factories import (
    days_ago,
    make_mechanic,
    make_office,
    make_record,
    make_vehicle,
    results,
)


class VehicleSearchTests(AuthenticatedAPITestCase):
    url = reverse('vehicle-list')

    def setUp(self):
        super().setUp()
        self.north = make_office(name='North', city='Leeds')
        self.south = make_office(name='South', city='Brighton')
        self.certified = make_mechanic(certification_number='CERT-AAA')
        self.other_mechanic = make_mechanic(certification_number='CERT-BBB')

        self.ford = make_vehicle(
            office=self.north, license_plate='FORD-1',
            make='Ford', model='Transit', active=True,
        )
        self.toyota = make_vehicle(
            office=self.south, license_plate='TOYO-1',
            make='Toyota', model='Hilux', active=True,
        )
        self.retired = make_vehicle(
            office=self.north, license_plate='OLD-1',
            make='Ford', model='Ranger', active=False,
        )

    def plates(self, query=''):
        response = self.client.get(f'{self.url}{query}')
        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        return sorted(row['license_plate'] for row in results(response))

    # -- individual filters ------------------------------------------------

    def test_no_filters_returns_everything(self):
        self.assertEqual(['FORD-1', 'OLD-1', 'TOYO-1'], self.plates())

    def test_filter_by_office(self):
        self.assertEqual(['FORD-1', 'OLD-1'],
                         self.plates(f'?office={self.north.pk}'))

    def test_filter_by_active(self):
        self.assertEqual(['FORD-1', 'TOYO-1'], self.plates('?active=true'))
        self.assertEqual(['OLD-1'], self.plates('?active=false'))

    def test_filter_by_make_is_case_insensitive(self):
        self.assertEqual(['FORD-1', 'OLD-1'], self.plates('?make=ford'))

    def test_filter_by_model(self):
        self.assertEqual(['TOYO-1'], self.plates('?model=hilux'))

    def test_filter_by_mechanic_certification_number(self):
        make_record(self.ford, mechanic=self.certified,
                    maintenance_date=days_ago(10))
        make_record(self.toyota, mechanic=self.other_mechanic,
                    maintenance_date=days_ago(10))

        self.assertEqual(['FORD-1'], self.plates('?certification_number=CERT-AAA'))

    def test_filter_by_maintenance_date_window(self):
        make_record(self.ford, maintenance_date=days_ago(10))
        make_record(self.toyota, maintenance_date=days_ago(400))

        window = f'?maintained_from={days_ago(30)}&maintained_to={days_ago(1)}'
        self.assertEqual(['FORD-1'], self.plates(window))

    # -- combinations ------------------------------------------------------

    def test_filters_combine_additively(self):
        self.assertEqual(
            ['FORD-1'],
            self.plates(f'?office={self.north.pk}&active=true&make=ford'),
        )

    def test_maintenance_filters_do_not_duplicate_vehicles(self):
        """The join-duplication trap.

        Filtering on a related table would ordinarily emit one row per matching
        maintenance record, so a vehicle with five matching records would be
        returned five times. The filter uses a subquery to keep the result set
        one row per vehicle.
        """
        for _ in range(5):
            make_record(self.ford, mechanic=self.certified,
                        maintenance_date=days_ago(10))

        plates = self.plates(
            f'?certification_number=CERT-AAA'
            f'&maintained_from={days_ago(30)}&maintained_to={days_ago(1)}'
        )

        self.assertEqual(['FORD-1'], plates)

    def test_combined_maintenance_filters_intersect_on_one_record(self):
        """Both maintenance conditions must hold for the *same* record.

        The certified mechanic worked outside the window; another mechanic
        worked inside it. Neither single record satisfies both, so the vehicle
        must not match.
        """
        make_record(self.ford, mechanic=self.certified,
                    maintenance_date=days_ago(400))
        make_record(self.ford, mechanic=self.other_mechanic,
                    maintenance_date=days_ago(10))

        plates = self.plates(
            f'?certification_number=CERT-AAA'
            f'&maintained_from={days_ago(30)}&maintained_to={days_ago(1)}'
        )

        self.assertEqual([], plates)

    def test_filters_matching_nothing_return_an_empty_list(self):
        self.assertEqual([], self.plates('?make=lamborghini'))

    # -- invalid input -----------------------------------------------------

    def test_unparseable_boolean_is_rejected(self):
        """A bad filter is a 400, not a silently unfiltered result set."""
        response = self.client.get(f'{self.url}?active=maybe')

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('active', response.json())

    def test_unknown_office_is_rejected(self):
        response = self.client.get(f'{self.url}?office=999999')

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('office', response.json())

    def test_malformed_date_is_rejected(self):
        response = self.client.get(f'{self.url}?maintained_from=not-a-date')

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('maintained_from', response.json())

    def test_inverted_date_window_is_rejected(self):
        response = self.client.get(
            f'{self.url}?maintained_from={days_ago(1)}&maintained_to={days_ago(30)}'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('maintained_to', response.json())


class DuplicateCheckTests(AuthenticatedAPITestCase):
    url = reverse('vehicle-check-duplicate')

    def setUp(self):
        super().setUp()
        self.office = make_office()
        self.existing = make_vehicle(
            office=self.office, vin='KNOWNVIN000000001',
            license_plate='TAKEN-1', active=True,
        )

    def conflicts(self, query):
        response = self.client.get(f'{self.url}{query}')
        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        return response.json()['conflicts']

    def test_reports_both_conflicting_fields(self):
        self.assertEqual(
            ['vin', 'license_plate'],
            self.conflicts('?vin=KNOWNVIN000000001&license_plate=TAKEN-1'),
        )

    def test_reports_no_conflict_for_fresh_values(self):
        self.assertEqual(
            [],
            self.conflicts('?vin=FRESHVIN000000001&license_plate=FREE-1'),
        )

    def test_vin_conflict_ignores_active_flag(self):
        """A VIN is unique for the life of the vehicle, retired or not."""
        retired = make_vehicle(
            office=self.office, vin='RETIREDVIN0000001',
            license_plate='GONE-1', active=False,
        )

        self.assertEqual(['vin'], self.conflicts(f'?vin={retired.vin}'))

    def test_plate_held_only_by_a_retired_vehicle_is_free(self):
        """Matches the partial constraint: retired plates are reusable."""
        make_vehicle(
            office=self.office, license_plate='REUSABLE-1', active=False,
        )

        self.assertEqual([], self.conflicts('?license_plate=REUSABLE-1'))

    def test_vin_match_is_case_insensitive(self):
        self.assertEqual(['vin'], self.conflicts('?vin=knownvin000000001'))

    def test_exclude_id_lets_a_vehicle_check_itself(self):
        """Without this an edit form reports the vehicle as its own duplicate."""
        query = (
            f'?vin={self.existing.vin}'
            f'&license_plate={self.existing.license_plate}'
            f'&exclude_id={self.existing.pk}'
        )

        self.assertEqual([], self.conflicts(query))

    def test_at_least_one_field_is_required(self):
        response = self.client.get(self.url)

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
