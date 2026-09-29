# Fleet Maintenance API

A Django REST Framework API for managing a fleet of vehicles, the offices they
are assigned to, the mechanics who service them, and their maintenance history.

- **Stack:** Python 3.13, Django 5.2, Django REST Framework 3.17, SQLite.
- **No extra dependencies** beyond the ones the scaffold shipped with.
- **92 tests**, all passing.

---

## Running the project

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_fleet          # dummy data, see below
python manage.py runserver 0.0.0.0:8000
```

The API is then at `http://localhost:8000/api/`. DRF's browsable interface is
enabled, so the endpoints can be explored in a browser; `curl` and axios get
JSON, because `JSONRenderer` is first in the renderer list.

`http://localhost:8000/admin/` is also wired up (`createsuperuser` to use it),
which is a convenient way to eyeball the seeded data.

### Configuration

Settings that would differ per environment read from the environment, with
development-friendly defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | the checked-in dev key | so a real deployment never ships it |
| `DJANGO_DEBUG` | `1` | set to `0` for production behaviour |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],0.0.0.0,testserver` | comma-separated |

## Running the tests

```bash
python manage.py test fleet          # all 92
python manage.py test fleet.tests.test_performance   # query-count tests only
```

Tests are grouped by what they protect:

| Module | Covers |
| --- | --- |
| `test_models.py` | database constraints, asserted at the DB layer |
| `test_api_crud.py` | CRUD, validation messages, status codes, assignment |
| `test_search.py` | every search filter, their combinations, duplicate check |
| `test_reports.py` | the three aggregate reports, with known-answer totals |
| `test_performance.py` | query counts - the N+1 guards |

## Seeding dummy data

```bash
python manage.py seed_fleet --flush
```

Roughly 90 vehicles and 1,500 maintenance records, reproducible via `--seed`.
Counts are adjustable (`--offices`, `--mechanics`, `--vehicles`).

Beyond bulk volume it deliberately plants the cases the reporting endpoints are
built around, so they can be exercised by hand immediately:

- a vehicle (plate `HEAVY-01`) with **600 maintenance records**, for the vehicle
  detail performance requirement;
- three active vehicles that have **never** been serviced;
- four active vehicles last serviced **400+ days ago**;
- plate `REUSE-99` shared by one retired and one active vehicle - legal, and the
  case a naive `unique=True` would wrongly reject;
- records sitting on **both sides** of the 365-day and calendar-year boundaries,
  so the windowing in the reports is verifiable rather than merely plausible.

The command prints a summary of what it planted.

---

## API reference

All routes are under `/api/`. List endpoints are paginated (`?page=`, 10 per
page).

### CRUD

| Method | Path | Notes |
| --- | --- | --- |
| `GET POST` | `/offices/` | |
| `GET PUT PATCH DELETE` | `/offices/{id}/` | delete is 409 if vehicles reference it |
| `GET POST` | `/mechanics/` | |
| `GET PUT PATCH DELETE` | `/mechanics/{id}/` | delete is 409 if history references them |
| `GET POST` | `/vehicles/` | `GET` is the search endpoint, below |
| `GET PUT PATCH DELETE` | `/vehicles/{id}/` | `GET` is the detail endpoint, below |
| `GET POST` | `/maintenance-records/` | `?vehicle={id}` to scope the list |
| `GET PUT PATCH DELETE` | `/maintenance-records/{id}/` | |

### Reports and actions

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/offices/summary/` | every office with active vehicle count, 12-month spend, last service date |
| `GET` | `/vehicles/?...` | vehicle search - filters below |
| `GET` | `/vehicles/{id}/` | vehicle with office, totals and full maintenance history |
| `GET` | `/vehicles/{id}/history/` | that vehicle's history, newest first |
| `POST` | `/vehicles/{id}/assign/` | `{"office": <id>}` - moves the vehicle |
| `GET` | `/mechanics/workload/` | mechanics ranked busiest first, year to date |
| `GET` | `/vehicles/needing-maintenance/` | active vehicles overdue for service |
| `GET` | `/vehicles/check-duplicate/?...` | `{"conflicts": [...]}` |

### Vehicle search parameters

All optional, all combinable:

| Parameter | Example | Behaviour |
| --- | --- | --- |
| `office` | `?office=3` | exact office id |
| `active` | `?active=true` | `true` / `false` |
| `make` | `?make=ford` | case-insensitive substring |
| `model` | `?model=transit` | case-insensitive substring |
| `maintained_from` | `?maintained_from=2025-01-01` | maintenance on or after |
| `maintained_to` | `?maintained_to=2025-12-31` | maintenance on or before |
| `certification_number` | `?certification_number=CERT-2001` | serviced by that mechanic |

An unparseable value is a `400` naming the parameter, rather than a silently
ignored filter that returns results the caller did not ask for.

### Duplicate check

```
GET /api/vehicles/check-duplicate/?vin=1HGCM82633A004352&license_plate=ABC-123
    -> {"conflicts": ["vin", "license_plate"]}
```

Pass `exclude_id={id}` when checking on behalf of an existing vehicle, so it is
not reported as its own duplicate.

---

## Performance notes

Database query performance was treated as a primary requirement, not an
afterthought. Query counts are **asserted in the test suite** rather than
claimed here, in `test_performance.py`.

| Endpoint | Queries | Scales with row count? |
| --- | --- | --- |
| `/offices/summary/` | **1** | no - flat in office count |
| `/mechanics/workload/` | **1** | no |
| `/vehicles/{id}/` (600 records) | **2** | no |
| `/vehicles/{id}/history/` | 3 | no |
| `/vehicles/` (search) | 2 | no |
| `/vehicles/needing-maintenance/` | 2 | no |
| `/maintenance-records/` | 2 | no |

## Tradeoffs

**SQLite.** Kept as the scaffold shipped it, so the project runs with no
services. The queries are written to be portable rather than SQLite-specific -
`nulls_first` is explicit precisely because SQLite and PostgreSQL disagree on
default NULL placement. On PostgreSQL the reporting subqueries would benefit
from partial indexes, which SQLite supports but plans less well.

**Hand-rolled filtering instead of `django-filter`.** The scaffold left
`DEFAULT_FILTER_BACKENDS` empty and did not include the package. Filtering is a
validated serializer plus a queryset builder, which is a little more code but
keeps the join-duplication handling explicit and adds no dependency.

**No Celery, no JWT.** Neither is required. The reports are single-query and
fast enough to serve synchronously; moving them to a task queue would add a
broker the reviewer has to run for no current benefit. The natural place for
Celery here would be a scheduled overdue-maintenance digest rather than the
request path.

**Query counts asserted, timings not.** `assertNumQueries` catches the bug that
actually matters - query count scaling with row count - and is deterministic in
CI, where wall-clock timings are not.

**No `select_for_update` on assignment.** Single-column `update_fields` write;
last write wins. Two simultaneous reassignments of the same vehicle would not
corrupt anything, and the brief has no concurrency requirement.

**Settings left in one file.** A real deployment would split
`settings/base|dev|prod`. For a single-environment exercise, environment
variables for the three values that matter is the better ratio.

---

## Layout

```
backend/
  fleet/
    models.py        4 models, constraints and indexes
    queries.py       queryset builders for search and the reports
    serializers.py   shaping and validation
    views.py         thin viewsets, per-action querysets
    exceptions.py    ProtectedError -> 409
    admin.py         browsable seeded data
    urls.py          DRF router
    migrations/
    management/commands/seed_fleet.py
    tests/
  server/            settings, root urlconf
```

Query construction lives in `queries.py` rather than in the views, so the query
shape - the part that has to stay fast - is in one place and testable on its own.
