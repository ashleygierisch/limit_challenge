"""Queryset builders for the reporting and search endpoints.

Keeping these out of the views makes them independently testable and keeps the
query shape -- which is the thing that actually has to stay fast -- in one
place. Every builder here is written to run in a constant number of queries
regardless of how many rows it returns.

Two recurring hazards are handled deliberately:

1. Aggregating across two different multi-valued joins in a single queryset
   multiplies the rows and inflates the results. Where that would happen the
   aggregate is computed with a correlated ``Subquery`` instead.
2. ``.values(...).annotate(...)`` inherits the model's ``Meta.ordering`` and
   silently adds those columns to the ``GROUP BY``. Every such subquery below
   calls ``.order_by()`` first to clear it.
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import (
    Count,
    DecimalField,
    Exists,
    F,
    IntegerField,
    Max,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce
from django.utils import timezone

from fleet.models import MaintenanceRecord, Mechanic, Office, Vehicle

# "Last 12 months" and "more than 365 days ago" are both read as rolling
# windows anchored on today rather than calendar years.
ROLLING_YEAR_DAYS = 365

MONEY = DecimalField(max_digits=14, decimal_places=2)
ZERO_MONEY = Value(Decimal('0.00'), output_field=MONEY)


def rolling_year_window(today=None):
    """The window the summary's "last 12 months" figure covers.

    Returned to the client alongside the figure so nothing downstream has to
    re-derive it -- a mirrored constant would also be computed from the
    browser's clock rather than the server's, and could differ by a day.
    """
    today = today or timezone.localdate()
    return today - timedelta(days=ROLLING_YEAR_DAYS), today


def office_summary_queryset(today=None):
    """Every office with active vehicle count, recent spend and last service.

    Runs as a single query. The three figures span two different joins
    (vehicles, and maintenance through vehicles), so combining them as plain
    aggregates would cross-multiply the rows: the vehicle count would be
    multiplied by the number of maintenance records and the cost sum by the
    number of vehicles. Correlated subqueries keep each figure independent.
    """
    cutoff, today = rolling_year_window(today)

    active_vehicles = (
        Vehicle.objects.filter(office=OuterRef('pk'), active=True)
        .order_by()
        .values('office')
        .annotate(total=Count('pk'))
        .values('total')[:1]
    )

    recent_cost = (
        MaintenanceRecord.objects.filter(
            vehicle__office=OuterRef('pk'),
            maintenance_date__gte=cutoff,
            maintenance_date__lte=today,
        )
        .order_by()
        .values('vehicle__office')
        .annotate(total=Sum('cost'))
        .values('total')[:1]
    )

    last_maintenance = (
        MaintenanceRecord.objects.filter(vehicle__office=OuterRef('pk'))
        .order_by()
        .values('vehicle__office')
        .annotate(latest=Max('maintenance_date'))
        .values('latest')[:1]
    )

    return Office.objects.annotate(
        active_vehicle_count=Coalesce(
            Subquery(active_vehicles, output_field=IntegerField()),
            Value(0),
        ),
        maintenance_cost_last_year=Coalesce(
            Subquery(recent_cost, output_field=MONEY),
            ZERO_MONEY,
        ),
        last_maintenance=Subquery(last_maintenance),
    ).order_by('name', 'id')


def search_vehicles(filters):
    """Vehicle list narrowed by any combination of the supported filters.

    ``filters`` is the ``validated_data`` of ``VehicleSearchSerializer``; every
    key is optional and absent keys are simply not applied.

    The maintenance-based filters (date window, mechanic certification) match
    against a related table. Joining would emit one row per matching
    maintenance record and return the same vehicle several times, so they are
    applied as a single ``pk__in`` subquery instead. That keeps the result set
    distinct without paying for a ``DISTINCT`` over the whole vehicle row.
    """
    queryset = Vehicle.objects.select_related('office')

    if filters.get('office') is not None:
        queryset = queryset.filter(office=filters['office'])

    if filters.get('active') is not None:
        queryset = queryset.filter(active=filters['active'])

    if filters.get('make'):
        queryset = queryset.filter(make__icontains=filters['make'])

    if filters.get('model'):
        queryset = queryset.filter(model__icontains=filters['model'])

    maintenance_filters = Q()

    if filters.get('maintained_from'):
        maintenance_filters &= Q(maintenance_date__gte=filters['maintained_from'])

    if filters.get('maintained_to'):
        maintenance_filters &= Q(maintenance_date__lte=filters['maintained_to'])

    if filters.get('certification_number'):
        maintenance_filters &= Q(
            mechanic__certification_number=filters['certification_number']
        )

    if maintenance_filters:
        matching_vehicle_ids = (
            MaintenanceRecord.objects.filter(maintenance_filters)
            .order_by()
            .values('vehicle_id')
        )
        queryset = queryset.filter(pk__in=Subquery(matching_vehicle_ids))

    return queryset


def vehicle_detail_queryset():
    """Vehicle with office and its full maintenance history.

    Two queries no matter how long the history is: one for the vehicle, one for
    the prefetched records, and none per record because the mechanic comes in
    with ``select_related``.
    """
    # The count and total are derived from the prefetched rows in the
    # serializer rather than annotated here: annotating would LEFT JOIN and
    # GROUP BY the whole history a second time just to produce two numbers the
    # prefetch already has in memory.
    return (
        Vehicle.objects.select_related('office')
        .prefetch_related(
            Prefetch(
                'maintenance_records',
                queryset=_history_base(),
                to_attr='prefetched_maintenance',
            )
        )
    )


def _history_base():
    """Maintenance rows, newest first, with the mechanic joined.

    Shared by the detail prefetch and the history endpoint so the two cannot
    disagree: the detail page reads the first record as "last service".
    Ordering matches the ``(vehicle, -maintenance_date)`` index, so the database
    reads it straight off the index without a sort.
    """
    return MaintenanceRecord.objects.select_related('mechanic').order_by(
        '-maintenance_date', '-id'
    )


def vehicle_history_queryset(vehicle_id):
    """Maintenance history for one vehicle, newest first."""
    return _history_base().filter(vehicle_id=vehicle_id)


def mechanic_workload_queryset(today=None):
    """Mechanics ranked by work completed in the current calendar year.

    "Current year" is read as the calendar year to date, which is how a
    year-to-date workload report is normally understood. Both aggregates cross
    the same join, so plain conditional aggregation is safe and this stays a
    single query. Mechanics with no work this year are kept, with zeroes, so
    the report doubles as a roster.
    """
    today = today or timezone.localdate()
    this_year = Q(maintenance_records__maintenance_date__year=today.year)

    return Mechanic.objects.annotate(
        records_this_year=Count('maintenance_records', filter=this_year),
        cost_this_year=Coalesce(
            Sum('maintenance_records__cost', filter=this_year),
            ZERO_MONEY,
            output_field=MONEY,
        ),
    ).order_by('-records_this_year', '-cost_this_year', 'name', 'id')


def vehicles_needing_maintenance_queryset(today=None):
    """Active vehicles never serviced, or not serviced in over 365 days.

    Never-serviced vehicles are the most overdue, so they sort first. That
    needs an explicit ``nulls_first``: SQLite and PostgreSQL disagree on where
    NULLs land by default, and relying on either is a portability bug.
    """
    today = today or timezone.localdate()
    cutoff = today - timedelta(days=ROLLING_YEAR_DAYS)

    last_maintenance = (
        MaintenanceRecord.objects.filter(vehicle=OuterRef('pk'))
        .order_by()
        .values('vehicle')
        .annotate(latest=Max('maintenance_date'))
        .values('latest')[:1]
    )

    # Filtering on the annotation would inline that MAX subquery into the WHERE
    # twice more, so each candidate's history is scanned three times. An
    # existence probe short-circuits on the first matching row, uses the
    # (vehicle, -maintenance_date) index, and covers the never-serviced case in
    # the same predicate -- leaving the subquery to run once, for display.
    serviced_recently = MaintenanceRecord.objects.filter(
        vehicle=OuterRef('pk'),
        maintenance_date__gte=cutoff,
    )

    return (
        Vehicle.objects.filter(active=True)
        .exclude(Exists(serviced_recently))
        .select_related('office')
        .annotate(last_maintenance=Subquery(last_maintenance))
        .order_by(F('last_maintenance').asc(nulls_first=True), 'vin')
    )


def find_vehicle_conflicts(vin=None, license_plate=None, exclude_id=None):
    """Return the field names on which an existing vehicle would conflict.

    The plate check is scoped to active vehicles only, matching the database
    constraint: reusing a retired vehicle's plate is legitimate, so reporting
    it as a conflict would block valid data entry.

    ``exclude_id`` lets an edit form check itself without the vehicle being
    reported as its own duplicate.
    """
    # A VIN identifies the vehicle for life; a plate only has to be unique
    # among active vehicles, matching the database constraint.
    candidates = (
        ('vin', vin, {}),
        ('license_plate', license_plate, {'active': True}),
    )

    conflicts = []
    for field, value, scope in candidates:
        if not value:
            continue
        existing = Vehicle.objects.filter(**{field: value.strip().upper()}, **scope)
        if exclude_id:
            existing = existing.exclude(pk=exclude_id)
        if existing.exists():
            conflicts.append(field)

    return conflicts
