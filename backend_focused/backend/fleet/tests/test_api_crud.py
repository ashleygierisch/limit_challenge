"""CRUD, validation and status-code tests for the four resources."""

from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from fleet.tests.base import AuthenticatedAPITestCase

from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle
from fleet.tests.factories import (
    days_ago,
    make_mechanic,
    make_office,
    make_record,
    make_vehicle,
    results,
    today,
)


class OfficeCrudTests(AuthenticatedAPITestCase):
    def test_full_lifecycle(self):
        create = self.client.post(
            reverse('office-list'),
            {'name': 'North', 'city': 'Leeds'},
            format='json',
        )
        self.assertEqual(status.HTTP_201_CREATED, create.status_code)
        office_id = create.json()['id']

        detail_url = reverse('office-detail', args=[office_id])
        self.assertEqual(status.HTTP_200_OK, self.client.get(detail_url).status_code)

        patch = self.client.patch(detail_url, {'city': 'York'}, format='json')
        self.assertEqual('York', patch.json()['city'])

        self.assertEqual(
            status.HTTP_204_NO_CONTENT,
            self.client.delete(detail_url).status_code,
        )
        self.assertFalse(Office.objects.filter(pk=office_id).exists())

    def test_missing_required_field_is_rejected(self):
        response = self.client.post(
            reverse('office-list'), {'name': 'Nameless'}, format='json'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('city', response.json())

    def test_duplicate_name_and_city_is_rejected(self):
        """The case the UI previously let through without complaint."""
        make_office(name='Central Depot', city='Springfield')

        response = self.client.post(
            reverse('office-list'),
            {'name': 'Central Depot', 'city': 'Springfield'},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('name', response.json())

    def test_duplicate_is_rejected_regardless_of_case_and_padding(self):
        make_office(name='Central Depot', city='Springfield')

        response = self.client.post(
            reverse('office-list'),
            {'name': '  central depot  ', 'city': ' SPRINGFIELD '},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('name', response.json())

    def test_renaming_an_office_onto_another_is_rejected(self):
        """A duplicate can be introduced by an edit, not only by a create."""
        make_office(name='Central Depot', city='Springfield')
        other = make_office(name='North Depot', city='Springfield')

        response = self.client.patch(
            reverse('office-detail', args=[other.pk]),
            {'name': 'Central Depot'},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('name', response.json())

    def test_saving_an_office_unchanged_does_not_self_conflict(self):
        office = make_office(name='Central Depot', city='Springfield')

        response = self.client.patch(
            reverse('office-detail', args=[office.pk]),
            {'name': 'Central Depot', 'city': 'Springfield'},
            format='json',
        )

        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)

    def test_editing_only_the_city_is_allowed(self):
        office = make_office(name='Central Depot', city='Springfield')

        response = self.client.patch(
            reverse('office-detail', args=[office.pk]),
            {'city': 'Shelbyville'},
            format='json',
        )

        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        self.assertEqual('Shelbyville', response.json()['city'])

    def test_name_and_city_are_stored_trimmed(self):
        response = self.client.post(
            reverse('office-list'),
            {'name': '  North Depot  ', 'city': '  Leeds  '},
            format='json',
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code)
        self.assertEqual('North Depot', response.json()['name'])
        self.assertEqual('Leeds', response.json()['city'])

    def test_deleting_an_office_with_vehicles_is_a_conflict(self):
        """PROTECT keeps history intact; the caller gets 409, not a 500."""
        office = make_office()
        make_vehicle(office=office)

        response = self.client.delete(reverse('office-detail', args=[office.pk]))

        self.assertEqual(status.HTTP_409_CONFLICT, response.status_code)
        self.assertIn('detail', response.json())
        self.assertTrue(Office.objects.filter(pk=office.pk).exists())


class MechanicCrudTests(AuthenticatedAPITestCase):
    def test_create_and_list(self):
        response = self.client.post(
            reverse('mechanic-list'),
            {'name': 'Sam', 'certification_number': 'CERT-1', 'active': True},
            format='json',
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code)
        self.assertEqual(1, len(results(self.client.get(reverse('mechanic-list')))))

    def test_certification_number_must_be_unique(self):
        make_mechanic(certification_number='CERT-DUP')

        response = self.client.post(
            reverse('mechanic-list'),
            {'name': 'Other', 'certification_number': 'CERT-DUP'},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('certification_number', response.json())

    def test_deleting_a_mechanic_with_history_is_a_conflict(self):
        mechanic = make_mechanic()
        make_record(make_vehicle(), mechanic=mechanic)

        response = self.client.delete(reverse('mechanic-detail', args=[mechanic.pk]))

        self.assertEqual(status.HTTP_409_CONFLICT, response.status_code)
        self.assertTrue(Mechanic.objects.filter(pk=mechanic.pk).exists())


class VehicleCrudTests(AuthenticatedAPITestCase):
    def setUp(self):
        super().setUp()
        self.office = make_office()

    def payload(self, **overrides):
        data = {
            'vin': 'NEWVIN00000000001',
            'license_plate': 'NEW-1',
            'make': 'Ford',
            'model': 'Transit',
            'year': 2021,
            'office': self.office.pk,
            'active': True,
        }
        data.update(overrides)
        return data

    def test_create_returns_nested_office(self):
        response = self.client.post(
            reverse('vehicle-list'), self.payload(), format='json'
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code)
        self.assertEqual(self.office.name, response.json()['office_detail']['name'])

    def test_vin_and_plate_are_normalised_to_uppercase(self):
        response = self.client.post(
            reverse('vehicle-list'),
            self.payload(vin='lowervin00000001', license_plate='lower-1'),
            format='json',
        )

        self.assertEqual('LOWERVIN00000001', response.json()['vin'])
        self.assertEqual('LOWER-1', response.json()['license_plate'])

    def test_duplicate_vin_is_rejected(self):
        make_vehicle(office=self.office, vin='NEWVIN00000000001')

        response = self.client.post(
            reverse('vehicle-list'), self.payload(), format='json'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('vin', response.json())

    def test_plate_taken_by_an_active_vehicle_is_rejected(self):
        make_vehicle(office=self.office, license_plate='NEW-1', active=True)

        response = self.client.post(
            reverse('vehicle-list'), self.payload(active=True), format='json'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('license_plate', response.json())

    def test_an_inactive_vehicle_may_reuse_an_active_plate(self):
        """Registering a retired vehicle must not be blocked by a live plate.

        DRF derives a UniqueValidator from the partial constraint and applies
        it regardless of the incoming ``active`` value; the serializer replaces
        it with a check that considers both sides.
        """
        make_vehicle(office=self.office, license_plate='NEW-1', active=True)

        response = self.client.post(
            reverse('vehicle-list'), self.payload(active=False), format='json'
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code, response.content)

    def test_an_active_vehicle_may_take_a_retired_plate(self):
        make_vehicle(office=self.office, license_plate='NEW-1', active=False)

        response = self.client.post(
            reverse('vehicle-list'), self.payload(active=True), format='json'
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code, response.content)

    def test_reactivating_a_vehicle_onto_a_taken_plate_is_rejected(self):
        """The conflict can be introduced by an update, not just a create."""
        make_vehicle(office=self.office, license_plate='SHARED', active=True)
        retired = make_vehicle(
            office=self.office, license_plate='SHARED', active=False
        )

        response = self.client.patch(
            reverse('vehicle-detail', args=[retired.pk]),
            {'active': True},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('license_plate', response.json())

    def test_updating_an_unrelated_field_does_not_self_conflict(self):
        vehicle = make_vehicle(office=self.office, active=True)

        response = self.client.patch(
            reverse('vehicle-detail', args=[vehicle.pk]),
            {'model': 'Custom'},
            format='json',
        )

        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)

    def test_implausible_year_is_rejected_with_a_message(self):
        response = self.client.post(
            reverse('vehicle-list'), self.payload(year=3000), format='json'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('year', response.json())

    def test_unknown_office_is_rejected(self):
        response = self.client.post(
            reverse('vehicle-list'), self.payload(office=999999), format='json'
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('office', response.json())

    def test_delete_removes_the_vehicle_and_its_history(self):
        vehicle = make_vehicle(office=self.office)
        make_record(vehicle)

        response = self.client.delete(reverse('vehicle-detail', args=[vehicle.pk]))

        self.assertEqual(status.HTTP_204_NO_CONTENT, response.status_code)
        self.assertFalse(Vehicle.objects.filter(pk=vehicle.pk).exists())
        self.assertEqual(0, MaintenanceRecord.objects.count())

    def test_detail_includes_office_history_and_totals(self):
        vehicle = make_vehicle(office=self.office)
        make_record(vehicle, maintenance_date=days_ago(5), cost='25.50')
        make_record(vehicle, maintenance_date=days_ago(50), cost='74.50')

        body = self.client.get(reverse('vehicle-detail', args=[vehicle.pk])).json()

        self.assertEqual(self.office.name, body['office']['name'])
        self.assertEqual(2, body['maintenance_count'])
        self.assertEqual(Decimal('100.00'), Decimal(body['total_maintenance_cost']))
        self.assertEqual(2, len(body['maintenance_records']))
        self.assertIn('name', body['maintenance_records'][0]['mechanic'])

    def test_detail_of_a_vehicle_with_no_history(self):
        vehicle = make_vehicle(office=self.office)

        body = self.client.get(reverse('vehicle-detail', args=[vehicle.pk])).json()

        self.assertEqual(0, body['maintenance_count'])
        self.assertEqual(Decimal('0.00'), Decimal(body['total_maintenance_cost']))
        self.assertEqual([], body['maintenance_records'])

    def test_unknown_vehicle_is_404(self):
        response = self.client.get(reverse('vehicle-detail', args=[999999]))

        self.assertEqual(status.HTTP_404_NOT_FOUND, response.status_code)


class AssignVehicleTests(AuthenticatedAPITestCase):
    def setUp(self):
        super().setUp()
        self.origin = make_office(name='Origin', city='A')
        self.destination = make_office(name='Destination', city='B')
        self.vehicle = make_vehicle(office=self.origin)

    def test_assign_moves_the_vehicle(self):
        response = self.client.post(
            reverse('vehicle-assign', args=[self.vehicle.pk]),
            {'office': self.destination.pk},
            format='json',
        )

        self.assertEqual(status.HTTP_200_OK, response.status_code, response.content)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.destination, self.vehicle.office)

    def test_assign_changes_nothing_but_the_office(self):
        """"Record only the new office assignment" -- no other field moves."""
        before = {
            'vin': self.vehicle.vin,
            'license_plate': self.vehicle.license_plate,
            'make': self.vehicle.make,
            'model': self.vehicle.model,
            'year': self.vehicle.year,
            'active': self.vehicle.active,
        }

        self.client.post(
            reverse('vehicle-assign', args=[self.vehicle.pk]),
            {'office': self.destination.pk},
            format='json',
        )

        self.vehicle.refresh_from_db()
        for field, value in before.items():
            self.assertEqual(value, getattr(self.vehicle, field), field)

    def test_assign_preserves_maintenance_history(self):
        make_record(self.vehicle, maintenance_date=days_ago(5))

        self.client.post(
            reverse('vehicle-assign', args=[self.vehicle.pk]),
            {'office': self.destination.pk},
            format='json',
        )

        self.assertEqual(1, self.vehicle.maintenance_records.count())

    def test_assigning_to_the_current_office_is_rejected(self):
        response = self.client.post(
            reverse('vehicle-assign', args=[self.vehicle.pk]),
            {'office': self.origin.pk},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('office', response.json())

    def test_assigning_to_an_unknown_office_is_rejected(self):
        response = self.client.post(
            reverse('vehicle-assign', args=[self.vehicle.pk]),
            {'office': 999999},
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)

    def test_assigning_an_unknown_vehicle_is_404(self):
        response = self.client.post(
            reverse('vehicle-assign', args=[999999]),
            {'office': self.destination.pk},
            format='json',
        )

        self.assertEqual(status.HTTP_404_NOT_FOUND, response.status_code)


class MaintenanceRecordCrudTests(AuthenticatedAPITestCase):
    def setUp(self):
        super().setUp()
        self.vehicle = make_vehicle()
        self.mechanic = make_mechanic()

    def payload(self, **overrides):
        data = {
            'vehicle': self.vehicle.pk,
            'mechanic': self.mechanic.pk,
            'maintenance_date': str(days_ago(3)),
            'maintenance_type': 'repair',
            'cost': '250.00',
            'notes': 'Replaced brake pads.',
        }
        data.update(overrides)
        return data

    def test_create_returns_nested_mechanic(self):
        response = self.client.post(
            reverse('maintenancerecord-list'), self.payload(), format='json'
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code)
        self.assertEqual(
            self.mechanic.name, response.json()['mechanic_detail']['name']
        )

    def test_future_date_is_rejected(self):
        """A record documents completed work, so a future date is a typo."""
        response = self.client.post(
            reverse('maintenancerecord-list'),
            self.payload(maintenance_date=str(today().replace(year=today().year + 1))),
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('maintenance_date', response.json())

    def test_todays_date_is_accepted(self):
        response = self.client.post(
            reverse('maintenancerecord-list'),
            self.payload(maintenance_date=str(today())),
            format='json',
        )

        self.assertEqual(status.HTTP_201_CREATED, response.status_code, response.content)

    def test_negative_cost_is_rejected(self):
        response = self.client.post(
            reverse('maintenancerecord-list'),
            self.payload(cost='-10.00'),
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('cost', response.json())

    def test_unknown_maintenance_type_is_rejected(self):
        response = self.client.post(
            reverse('maintenancerecord-list'),
            self.payload(maintenance_type='teleportation'),
            format='json',
        )

        self.assertEqual(status.HTTP_400_BAD_REQUEST, response.status_code)
        self.assertIn('maintenance_type', response.json())

    def test_cost_keeps_two_decimal_places(self):
        """Money is a Decimal end to end, never a float."""
        response = self.client.post(
            reverse('maintenancerecord-list'),
            self.payload(cost='1234.56'),
            format='json',
        )

        self.assertEqual('1234.56', response.json()['cost'])

    def test_list_can_be_scoped_to_one_vehicle(self):
        make_record(self.vehicle, mechanic=self.mechanic)
        make_record(make_vehicle(), mechanic=self.mechanic)

        response = self.client.get(
            f'{reverse("maintenancerecord-list")}?vehicle={self.vehicle.pk}'
        )

        self.assertEqual(1, len(results(response)))

    def test_update_and_delete(self):
        record = make_record(self.vehicle, mechanic=self.mechanic)
        detail_url = reverse('maintenancerecord-detail', args=[record.pk])

        patch = self.client.patch(detail_url, {'cost': '99.99'}, format='json')
        self.assertEqual('99.99', patch.json()['cost'])

        self.assertEqual(
            status.HTTP_204_NO_CONTENT, self.client.delete(detail_url).status_code
        )
