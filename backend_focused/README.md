# Fleet Maintenance - take-home submission

A Django REST Framework API for managing a fleet of vehicles, the offices they
are assigned to, the mechanics who service them and their maintenance history,
plus a Next.js front end over it.

The original brief is preserved as [Require.md](Require.md).

| | |
| --- | --- |
| **Backend** | Python 3.13, Django 5.2, DRF 3.17, SQLite - no dependencies beyond the scaffold's |
| **Frontend** | Next.js 16, React 19, MUI 7 (+ X Date Pickers, Icons), TanStack Query 5, axios, dayjs |
| **Tests** | 118, all passing |
| **Detailed backend notes** | [`backend/README.md`](backend/README.md) - API reference, performance analysis, tradeoffs |

All nine required endpoint groups are implemented, plus a front end covering the
CRUD endpoints, vehicle search, and *vehicles needing maintenance* as the chosen
extra.

---

## Running it

Two terminals. The backend first - the front end is a pure client of it.

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_fleet        # dummy data - see below
python manage.py runserver 0.0.0.0:8000
```

API at `http://localhost:8000/api/`, browsable in a browser, JSON for clients.
Django admin at `http://localhost:8000/admin/` (`createsuperuser` to use it).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                        # NEXT_PUBLIC_API_BASE_URL defaults to http://localhost:8000/api
```

Then open `http://localhost:3000`.

> **If `npm run dev` exits immediately with no error message**, use
> `npm run dev:webpack` (and `npm run build:webpack`). Next 16 defaults to
> Turbopack, which terminates silently on some Windows setups; the webpack
> builder is equivalent for this app. Both script variants are in
> `package.json`.

### Running the tests

```bash
cd backend
python manage.py test fleet                          # all 92
python manage.py test fleet.tests.test_performance   # the query-count tests
```

```bash
cd frontend
npm run lint          # eslint + prettier
npx tsc --noEmit      # type check
```

### Seeding dummy data

```bash
cd backend
python manage.py seed_fleet --flush
```

About 90 vehicles and 1,500 maintenance records via Faker, reproducible with
`--seed`, sizes adjustable with `--offices`, `--mechanics`, `--vehicles`.

It also deliberately plants the cases the reporting endpoints are built around,
so they can be exercised by hand straight away - a vehicle with **600**
maintenance records, vehicles never serviced, vehicles overdue by 400+ days, a
license plate legally shared between a retired and an active vehicle, and
records sitting on both sides of the 365-day and calendar-year boundaries. The
command prints what it planted.

---

## What's where

```
backend/
  fleet/
    models.py       4 models, constraints, indexes
    queries.py      queryset builders for search and the three reports
    serializers.py  shaping and validation
    views.py        thin viewsets, per-action querysets
    exceptions.py   ProtectedError -> 409
    management/commands/seed_fleet.py
    tests/          models, CRUD, search, reports, query counts
frontend/
  app/              vehicles (/), vehicles/[id], needing-maintenance, offices, mechanics
  components/       filters, sortable tables, dialogs, shared query states
  lib/              typed API client, query keys, URL-bound filter hook
```

Query construction lives in `queries.py` rather than in the views, so the query
shape - the part that has to stay fast - is in one place and testable on its own.

---

## Assumptions

The brief leaves some things open. These are the readings taken.

- **A plate is unique only among active vehicles.** Plates are reissued once a
  vehicle retires. This applies to the incoming record too, so a vehicle saved
  as retired may take a plate an active one still holds.
- **An office is unique by name within a city**, compared case-insensitively.
  The same name in two cities is fine. Twice in one city would split that
  office's vehicles across two rows in every report.
- **"Record only the new office assignment"** means update the vehicle's office
  and change nothing else. No assignment history is kept.
- **"Last 12 months" is a rolling 365 days; "the current year" is the calendar
  year to date.** The brief words the two differently, so they behave
  differently.
- **The date and mechanic filters intersect on a single record.** Using both
  means "serviced by that mechanic within that window", not two independent
  conditions.
- **Certification numbers are unique**, because vehicle search filters on the
  number alone.
- **Maintenance dates cannot be in the future.** A record documents completed
  work. Today is accepted.
- **Deleting an office or mechanic is refused while records reference it** (409).
  Deleting a vehicle does remove its history. Both carry an active flag, which
  is the intended way to retire one.
