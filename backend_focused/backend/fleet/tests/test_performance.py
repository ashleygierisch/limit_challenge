"""Query-count tests.

The README requires vehicle detail to stay fast when a vehicle has hundreds of
maintenance records, and grades database query performance generally. A
response can be correct and still be quadratic, so correctness tests alone will
not catch a regression here -- these assert the query count directly.

``assertNumQueries`` is the useful assertion because the bug being guarded
against is N+1: query *count* scaling with row count. Each test therefore
proves the count is the same for a small and a large dataset.
"""

from django.test import TestCase
from django.urls import reverse

from fleet import queries
from fleet.tests.factories import (
    days_ago,
    make_mechanic,
    make_office,
    make_record,
    make_vehicle,
)

# Every list endpoint costs one COUNT for the paginator plus one page query.
PAGINATED_QUERIES = 2


class VehicleDetailQueryCountTests(TestCase):
    """Vehicle detail: fixed cost regardless of history length."""

    EXPECTED_QUERIES = 2  # vehicle + aggregates, then the prefetched history.

    def _build(self, record_count):
        office = make_office()
        vehicle = make_vehicle(office=office)
        # Several mechanics, so a missing select_related on the nested mechanic
        # shows up as extra queries rather than being masked by a single
        # repeatedly cached row.
        mechanics = [make_mechanic() for _ in range(5)]
        for index in range(record_count):
            make_record(
                vehicle,
                mechanic=mechanics[index % len(mechanics)],
                maintenance_date=days_ago(index + 1),
            )
        return vehicle

    def test_detail_with_few_records(self):
        vehicle = self._build(5)

        with self.assertNumQueries(self.EXPECTED_QUERIES):
            self.client.get(reverse('vehicle-detail', args=[vehicle.pk]))

    def test_detail_with_hundreds_of_records_costs_the_same(self):
        """The requirement from the brief, asserted directly.

        400 records across 5 mechanics. Without the prefetch and its nested
        ``select_related`` this would be roughly 400 extra queries.
        """
        vehicle = self._build(400)

        with self.assertNumQueries(self.EXPECTED_QUERIES):
            response = self.client.get(reverse('vehicle-detail', args=[vehicle.pk]))

        self.assertEqual(400, len(response.json()['maintenance_records']))

    def test_history_endpoint_does_not_scale_with_record_count(self):
        # Three: the existence check that produces a 404 for an unknown
        # vehicle, then the paginator's COUNT and the page itself. The nested
        # mechanic rides along on the page query via select_related.
        vehicle = self._build(300)

        with self.assertNumQueries(PAGINATED_QUERIES + 1):
            self.client.get(reverse('vehicle-history', args=[vehicle.pk]) + '?page=1')


class ReportQueryCountTests(TestCase):
    """The aggregate reports are single-query regardless of row count."""

    def _populate(self, offices, vehicles_per_office, records_per_vehicle):
        mechanics = [make_mechanic() for _ in range(4)]
        for _ in range(offices):
            office = make_office(city='City')
            for _ in range(vehicles_per_office):
                vehicle = make_vehicle(office=office)
                for index in range(records_per_vehicle):
                    make_record(
                        vehicle,
                        mechanic=mechanics[index % len(mechanics)],
                        maintenance_date=days_ago(index + 1),
                    )

    def test_office_summary_is_one_query(self):
        self._populate(offices=8, vehicles_per_office=5, records_per_vehicle=4)

        with self.assertNumQueries(1):
            response = self.client.get(reverse('office-summary'))

        self.assertEqual(8, len(response.json()))

    def test_office_summary_query_count_is_flat_in_office_count(self):
        """One office or twenty, still one query -- no per-office lookups."""
        self._populate(offices=1, vehicles_per_office=2, records_per_vehicle=2)
        with self.assertNumQueries(1):
            self.client.get(reverse('office-summary'))

        self._populate(offices=19, vehicles_per_office=2, records_per_vehicle=2)
        with self.assertNumQueries(1):
            self.client.get(reverse('office-summary'))

    def test_mechanic_workload_is_one_query(self):
        self._populate(offices=2, vehicles_per_office=4, records_per_vehicle=6)

        with self.assertNumQueries(1):
            self.client.get(reverse('mechanic-workload'))

    def test_vehicles_needing_maintenance_is_paginated_constant(self):
        office = make_office()
        for index in range(40):
            vehicle = make_vehicle(office=office)
            if index % 2:
                make_record(vehicle, maintenance_date=days_ago(500 + index))

        with self.assertNumQueries(PAGINATED_QUERIES):
            self.client.get(reverse('vehicle-needing-maintenance'))


class ListQueryCountTests(TestCase):
    """List endpoints must not issue a query per row for nested data."""

    def test_vehicle_list_does_not_query_per_row(self):
        """Each row nests its office; select_related keeps that free."""
        for index in range(10):
            make_vehicle(office=make_office(name=f'Office {index}', city='C'))

        with self.assertNumQueries(PAGINATED_QUERIES):
            self.client.get(reverse('vehicle-list'))

    def test_maintenance_record_list_does_not_query_per_row(self):
        vehicle = make_vehicle()
        for index in range(10):
            make_record(vehicle, mechanic=make_mechanic(),
                        maintenance_date=days_ago(index + 1))

        with self.assertNumQueries(PAGINATED_QUERIES):
            self.client.get(reverse('maintenancerecord-list'))

    def test_search_with_maintenance_filters_adds_no_per_row_queries(self):
        """The subquery-based filter stays inline; it is not a second round trip."""
        office = make_office()
        mechanic = make_mechanic(certification_number='CERT-PERF')
        for _ in range(10):
            vehicle = make_vehicle(office=office)
            make_record(vehicle, mechanic=mechanic, maintenance_date=days_ago(5))

        url = (
            f'{reverse("vehicle-list")}?certification_number=CERT-PERF'
            f'&maintained_from={days_ago(30)}&maintained_to={days_ago(1)}'
        )
        # The maintenance conditions become an inline subquery on the page
        # query rather than a separate round trip, so the count is unchanged
        # from an unfiltered list. (Passing ?office= would add exactly one
        # query, where the serializer resolves the office it validates.)
        with self.assertNumQueries(PAGINATED_QUERIES):
            self.client.get(url)


class QuerysetShapeTests(TestCase):
    """Guards on the queryset builders themselves, independent of the views."""

    def test_office_summary_subqueries_are_not_grouped_by_ordering(self):
        """Regression guard for a subtle aggregation bug.

        ``.values(...).annotate(...)`` inherits ``Meta.ordering`` and adds those
        columns to the GROUP BY, which splits one group per distinct ordering
        value and makes each subquery return a partial figure. The builders call
        ``.order_by()`` to clear it; this asserts the resulting SQL has no
        stray GROUP BY columns.
        """
        sql = str(queries.office_summary_queryset().query)

        # Vehicle orders by make/model/vin and MaintenanceRecord by date/id;
        # none of those belong in an aggregate subquery's grouping.
        self.assertNotIn('GROUP BY "fleet_vehicle"."make"', sql)
        self.assertNotIn('"fleet_maintenancerecord"."id"', sql.split('GROUP BY')[-1])

    def test_needing_maintenance_orders_nulls_first_explicitly(self):
        """SQLite and PostgreSQL disagree on default NULL placement."""
        sql = str(queries.vehicles_needing_maintenance_queryset().query)

        self.assertIn('NULLS FIRST', sql.upper())
