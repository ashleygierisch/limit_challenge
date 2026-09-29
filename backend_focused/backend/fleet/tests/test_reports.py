"""Tests for the aggregate reporting endpoints.

Each report is asserted against hand-built data with known totals, because the
failure mode these endpoints are prone to -- joins multiplying rows so counts
and sums come back inflated -- produces plausible-looking numbers that only a
known-answer test catches.
"""

from datetime import timedelta
from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from fleet.tests.factories import (
    days_ago,
    make_mechanic,
    make_office,
    make_record,
    make_vehicle,
    results,
    today,
)


class OfficeSummaryTests(APITestCase):
    url = reverse('office-summary')

    def test_aggregates_do_not_multiply_across_joins(self):
        """The regression this endpoint exists to avoid.

        One office, two active vehicles, three maintenance records each. A
        naive ``Count('vehicles') + Sum('vehicles__maintenance_records__cost')``
        returns a vehicle count of 6 (2 x 3 rows) and a cost of 1200 (600 x 2),
        because the two joins cross-multiply.
        """
        office = make_office(name='Central', city='Springfield')
        mechanic = make_mechanic()
        for _ in range(2):
            vehicle = make_vehicle(office=office, active=True)
            for _ in range(3):
                make_record(
                    vehicle,
                    mechanic=mechanic,
                    maintenance_date=days_ago(30),
                    cost='100.00',
                )

        row = results(self.client.get(self.url))[0]

        self.assertEqual(2, row['active_vehicle_count'])
        self.assertEqual(Decimal('600.00'), Decimal(row['maintenance_cost_last_year']))

    def test_summary_publishes_the_window_it_summed(self):
        """Clients link to "the vehicles behind this figure" using these dates.

        Publishing them keeps the window in one place; a client re-deriving it
        would also be using its own clock rather than the server's.
        """
        make_office()

        row = results(self.client.get(self.url))[0]

        self.assertEqual(str(days_ago(365)), row['maintenance_window_start'])
        self.assertEqual(str(today()), row['maintenance_window_end'])

    def test_inactive_vehicles_are_excluded_from_the_count(self):
        office = make_office()
        make_vehicle(office=office, active=True)
        make_vehicle(office=office, active=False)

        row = results(self.client.get(self.url))[0]

        self.assertEqual(1, row['active_vehicle_count'])

    def test_cost_window_covers_exactly_the_last_365_days(self):
        office = make_office()
        vehicle = make_vehicle(office=office)
        make_record(vehicle, maintenance_date=days_ago(365), cost='10.00')
        make_record(vehicle, maintenance_date=days_ago(366), cost='999.00')

        row = results(self.client.get(self.url))[0]

        self.assertEqual(Decimal('10.00'), Decimal(row['maintenance_cost_last_year']))

    def test_last_maintenance_ignores_the_cost_window(self):
        """Spend is windowed; the most recent service date is all-time."""
        office = make_office()
        vehicle = make_vehicle(office=office)
        make_record(vehicle, maintenance_date=days_ago(800), cost='50.00')

        row = results(self.client.get(self.url))[0]

        self.assertEqual(Decimal('0.00'), Decimal(row['maintenance_cost_last_year']))
        self.assertEqual(str(days_ago(800)), row['last_maintenance'])

    def test_empty_office_reports_zeroes_rather_than_nulls(self):
        make_office(name='Brand New', city='Nowhere')

        row = results(self.client.get(self.url))[0]

        self.assertEqual(0, row['active_vehicle_count'])
        self.assertEqual(Decimal('0.00'), Decimal(row['maintenance_cost_last_year']))
        self.assertIsNone(row['last_maintenance'])

    def test_offices_are_isolated_from_each_other(self):
        first = make_office(name='Alpha', city='A')
        second = make_office(name='Beta', city='B')
        make_record(make_vehicle(office=first), cost='20.00',
                    maintenance_date=days_ago(5))
        make_record(make_vehicle(office=second), cost='300.00',
                    maintenance_date=days_ago(5))

        rows = {row['name']: row for row in results(self.client.get(self.url))}

        self.assertEqual(Decimal('20.00'),
                         Decimal(rows['Alpha']['maintenance_cost_last_year']))
        self.assertEqual(Decimal('300.00'),
                         Decimal(rows['Beta']['maintenance_cost_last_year']))


class MechanicWorkloadTests(APITestCase):
    url = reverse('mechanic-workload')

    def test_counts_only_the_current_calendar_year(self):
        mechanic = make_mechanic(name='Busy')
        vehicle = make_vehicle()
        make_record(vehicle, mechanic=mechanic,
                    maintenance_date=today().replace(month=1, day=1),
                    cost='40.00')
        last_year = today().replace(month=1, day=1) - timedelta(days=1)
        make_record(vehicle, mechanic=mechanic,
                    maintenance_date=last_year, cost='999.00')

        row = results(self.client.get(self.url))[0]

        self.assertEqual(1, row['records_this_year'])
        self.assertEqual(Decimal('40.00'), Decimal(row['cost_this_year']))

    def test_ordered_busiest_first(self):
        vehicle = make_vehicle()
        quiet = make_mechanic(name='Quiet')
        busy = make_mechanic(name='Busy')
        make_record(vehicle, mechanic=quiet, maintenance_date=days_ago(2))
        for _ in range(3):
            make_record(vehicle, mechanic=busy, maintenance_date=days_ago(2))

        rows = results(self.client.get(self.url))

        self.assertEqual(['Busy', 'Quiet'], [row['name'] for row in rows])

    def test_report_carries_the_active_flag(self):
        """Self-sufficient: a client can show status without a second request."""
        make_mechanic(name='Retired', active=False)

        row = results(self.client.get(self.url))[0]

        self.assertIn('active', row)
        self.assertFalse(row['active'])

    def test_idle_mechanics_are_listed_with_zeroes(self):
        make_mechanic(name='Idle')

        row = results(self.client.get(self.url))[0]

        self.assertEqual(0, row['records_this_year'])
        self.assertEqual(Decimal('0.00'), Decimal(row['cost_this_year']))


class VehiclesNeedingMaintenanceTests(APITestCase):
    url = reverse('vehicle-needing-maintenance')

    def test_never_serviced_vehicles_come_first(self):
        """NULL ordering is explicit, not left to the backend's default."""
        office = make_office()
        serviced = make_vehicle(office=office, license_plate='SERVICED')
        make_record(serviced, maintenance_date=days_ago(500))
        make_vehicle(office=office, license_plate='NEVER')

        rows = results(self.client.get(self.url))

        self.assertEqual(['NEVER', 'SERVICED'],
                         [row['license_plate'] for row in rows])
        self.assertIsNone(rows[0]['last_maintenance'])
        self.assertIsNone(rows[0]['days_since_maintenance'])

    def test_boundary_at_365_days(self):
        office = make_office()
        just_inside = make_vehicle(office=office, license_plate='FRESH')
        make_record(just_inside, maintenance_date=days_ago(365))
        overdue = make_vehicle(office=office, license_plate='OVERDUE')
        make_record(overdue, maintenance_date=days_ago(366))

        plates = [row['license_plate'] for row in results(self.client.get(self.url))]

        self.assertEqual(['OVERDUE'], plates)

    def test_inactive_vehicles_are_never_reported(self):
        """A retired vehicle does not need servicing."""
        make_vehicle(license_plate='RETIRED', active=False)

        self.assertEqual([], results(self.client.get(self.url)))

    def test_ordered_oldest_maintenance_first(self):
        office = make_office()
        for plate, age in [('RECENT', 400), ('ANCIENT', 900), ('MIDDLE', 600)]:
            vehicle = make_vehicle(office=office, license_plate=plate)
            make_record(vehicle, maintenance_date=days_ago(age))

        plates = [row['license_plate'] for row in results(self.client.get(self.url))]

        self.assertEqual(['ANCIENT', 'MIDDLE', 'RECENT'], plates)

    def test_days_since_maintenance_is_reported(self):
        vehicle = make_vehicle(license_plate='OLD')
        make_record(vehicle, maintenance_date=days_ago(400))

        row = results(self.client.get(self.url))[0]

        self.assertEqual(400, row['days_since_maintenance'])


class VehicleHistoryTests(APITestCase):
    def test_history_is_newest_first(self):
        vehicle = make_vehicle()
        for age in [10, 300, 100]:
            make_record(vehicle, maintenance_date=days_ago(age))

        response = self.client.get(reverse('vehicle-history', args=[vehicle.pk]))

        dates = [row['maintenance_date'] for row in results(response)]
        self.assertEqual(sorted(dates, reverse=True), dates)

    def test_history_excludes_other_vehicles(self):
        vehicle = make_vehicle()
        make_record(vehicle, maintenance_date=days_ago(5))
        make_record(make_vehicle(), maintenance_date=days_ago(5))

        response = self.client.get(reverse('vehicle-history', args=[vehicle.pk]))

        self.assertEqual(1, len(results(response)))

    def test_history_of_unknown_vehicle_is_404(self):
        response = self.client.get(reverse('vehicle-history', args=[999999]))

        self.assertEqual(status.HTTP_404_NOT_FOUND, response.status_code)
