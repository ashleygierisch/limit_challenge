"""Tests for ``?ordering=`` on the paginated list endpoints.

Sorting a paginated table has to happen in the database. Sorting the ten rows
the client already holds would silently reorder only the current page, so these
assert against the full result set rather than one page.
"""

from django.urls import reverse
from rest_framework import status
from fleet.tests.base import AuthenticatedAPITestCase

from fleet.tests.factories import (
    days_ago,
    make_office,
    make_record,
    make_vehicle,
    results,
)


class VehicleOrderingTests(AuthenticatedAPITestCase):
    url = reverse('vehicle-list')

    def setUp(self):
        super().setUp()
        self.north = make_office(name='Alpha Office', city='A')
        self.south = make_office(name='Zulu Office', city='Z')

        make_vehicle(office=self.south, vin='VIN00000000000C', license_plate='PLATE-C',
                     make='Toyota', model='Hilux', year=2015, active=True)
        make_vehicle(office=self.north, vin='VIN00000000000A', license_plate='PLATE-A',
                     make='Ford', model='Transit', year=2021, active=False)
        make_vehicle(office=self.north, vin='VIN00000000000B', license_plate='PLATE-B',
                     make='Ford', model='Escape', year=2018, active=True)

    def column(self, query, key='vin'):
        response = self.client.get(f'{self.url}{query}')
        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        return [row[key] for row in results(response)]

    def test_ascending_by_vin(self):
        self.assertEqual(
            ['VIN00000000000A', 'VIN00000000000B', 'VIN00000000000C'],
            self.column('?ordering=vin'),
        )

    def test_descending_by_vin(self):
        self.assertEqual(
            ['VIN00000000000C', 'VIN00000000000B', 'VIN00000000000A'],
            self.column('?ordering=-vin'),
        )

    def test_ordering_by_several_fields(self):
        """A column rendered from several fields sorts by all of them.

        The "Vehicle" column shows make, model and year, so it sends all three
        and the two Fords must order by model.
        """
        self.assertEqual(
            ['Escape', 'Transit', 'Hilux'],
            self.column('?ordering=make,model,year', key='model'),
        )

    def test_ordering_across_a_relation(self):
        self.assertEqual(
            ['PLATE-A', 'PLATE-B', 'PLATE-C'],
            self.column('?ordering=office__name,license_plate', key='license_plate'),
        )

    def test_unknown_field_is_ignored(self):
        """An unrecognised column falls back to the default order, not a 500."""
        response = self.client.get(f'{self.url}?ordering=not_a_column')

        self.assertEqual(status.HTTP_200_OK, response.status_code)
        # Default Meta.ordering is make, model, vin.
        self.assertEqual(['Escape', 'Transit', 'Hilux'],
                         [row['model'] for row in results(response)])

    def test_non_whitelisted_field_is_ignored(self):
        """Ordering is whitelisted, so internal fields are not exposed."""
        self.assertEqual(
            self.column('?ordering=id'),
            self.column(''),
        )

    def test_ordering_combines_with_filters(self):
        plates = self.column('?make=ford&ordering=-license_plate',
                             key='license_plate')

        self.assertEqual(['PLATE-B', 'PLATE-A'], plates)

    def test_ordering_does_not_change_the_result_count(self):
        self.assertEqual(3, len(self.column('?ordering=active')))


class OrderingStabilityTests(AuthenticatedAPITestCase):
    """A tie must not let a row appear on two pages, or on none."""

    url = reverse('vehicle-list')

    def test_paging_a_low_cardinality_sort_yields_every_row_once(self):
        """The regression the tiebreaker exists to prevent.

        ``active`` has two distinct values, so 25 rows are almost entirely tied.
        Without a unique tiebreaker the database may order tied rows differently
        per query, and paging then duplicates some rows and drops others.
        """
        office = make_office()
        for index in range(25):
            make_vehicle(office=office, active=index % 2 == 0)

        collected = []
        page = 1
        while True:
            response = self.client.get(f'{self.url}?ordering=active&page={page}')
            body = response.json()
            collected += [row['id'] for row in body['results']]
            if not body['next']:
                break
            page += 1

        self.assertEqual(25, len(collected))
        self.assertEqual(25, len(set(collected)), 'a row was duplicated across pages')


class OverdueOrderingTests(AuthenticatedAPITestCase):
    url = reverse('vehicle-needing-maintenance')

    def setUp(self):
        super().setUp()
        self.office = make_office()
        self.never = make_vehicle(office=self.office, license_plate='NEVER')
        self.older = make_vehicle(office=self.office, license_plate='OLDER')
        make_record(self.older, maintenance_date=days_ago(900))
        self.newer = make_vehicle(office=self.office, license_plate='NEWER')
        make_record(self.newer, maintenance_date=days_ago(400))

    def plates(self, query=''):
        response = self.client.get(f'{self.url}{query}')
        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        return [row['license_plate'] for row in results(response)]

    def test_default_order_is_preserved_without_an_ordering_param(self):
        """The endpoint's own "most overdue first" must survive."""
        self.assertEqual(['NEVER', 'OLDER', 'NEWER'], self.plates())

    def test_ascending_puts_never_serviced_first(self):
        """A missing date sorts lowest, explicitly rather than per-backend."""
        self.assertEqual(['NEVER', 'OLDER', 'NEWER'],
                         self.plates('?ordering=last_maintenance'))

    def test_descending_puts_never_serviced_last(self):
        self.assertEqual(['NEWER', 'OLDER', 'NEVER'],
                         self.plates('?ordering=-last_maintenance'))

    def test_sortable_by_a_plain_column(self):
        self.assertEqual(['NEVER', 'NEWER', 'OLDER'],
                         self.plates('?ordering=license_plate'))

    def test_ordering_does_not_widen_the_result_set(self):
        """Sorting must not pull in vehicles that are not overdue."""
        recent = make_vehicle(office=self.office, license_plate='RECENT')
        make_record(recent, maintenance_date=days_ago(10))

        self.assertNotIn('RECENT', self.plates('?ordering=last_maintenance'))
