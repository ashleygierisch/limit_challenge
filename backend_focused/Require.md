# Fleet Maintenance API Take-home Challenge

Build a REST API for managing a fleet of vehicles and their maintenance history.

Use Python, Django and Django REST Framework.

The API does not need authentication or a frontend.

## Domain

A company owns vehicles that are assigned to offices around the country.
Vehicles periodically receive maintenance services performed by mechanics.
A vehicle may have many maintenance records.
A mechanic may service many vehicles.
Each office has many vehicles.

Offices

An office has:
* name
* city

Vehicles

A vehicle has:
* VIN (Vehicle Identification Number)
* license plate
* make
* model
* year
* office
* active flag

A VIN must uniquely identify a vehicle.
A license plate cannot be shared by two active vehicles.

Provide CRUD endpoints.

A mechanic has:

name
certification number
active flag

Provide CRUD endpoints.

Maintenance Records

A maintenance record contains:

vehicle
mechanic
maintenance date
maintenance type
cost
notes

Provide CRUD endpoints.

## API endpoints

1. CRUD endpoints for offices, vehicles, mechanics and maintenance records.

2. Office summary

It should return every office together with:
* number of active vehicles
* total maintenance cost during the last 12 months
* date of the most recent maintenance performed on any vehicle in that office

Example:
[
    {
        "name": "New York",
        "city": "New York",
        "active_vehicle_count": 42,
        "maintenance_cost_last_year": 81250.50,
        "last_maintenance": "2025-02-18"
    }
]

3. Vehicle search

It should support optional filtering by any combination of:

* office
* active/inactive
* make
* model
* maintenance performed between two dates
* mechanic certification number

4. Vehicle details

Return vehicle details together with:
* office information
* complete maintenance history
* mechanic information for each maintenance record

The endpoint should perform well when a vehicle has hundreds of maintenance records.

5. Vehicle maintenance history

Provide an endpoint that returns the maintenance history for a single vehicle ordered from newest to oldest.

6. Assign vehicle

Provide an endpoint that moves a vehicle from one office to another.

The endpoint should record only the new office assignment.

7. Mechanic workload

It should return:
* mechanic name
* number of maintenance records completed during the current year
* total maintenance cost of work performed during the current year

Order mechanics from busiest to least busy.

8. Vehicles needing maintenance

It should return all active vehicles that satisfy either of the following:
* have never received maintenance
* last maintenance was more than 365 days ago

Order by oldest maintenance first.

9. Duplicate vehicle check

Given VIN and license plate, it should return whether another conflicting vehicle already exists and identifies the conflicting fields.

Example:

{
    "conflicts": [
        "vin",
        "license_plate"
    ]
}

## Front-end

If you know React, implement a front-end that uses the CRUD endpoints, the vehicle search one 
and another endpoint you choose.

The Next.js 16 + React 19 app in `frontend/` is pre-wired for this challenge. Material UI handles
layout, axios powers HTTP requests, and `@tanstack/react-query` is ready for data fetching. 

## Error Handling

Return appropriate HTTP status codes for invalid requests.
Validation errors should include meaningful messages.

## Project Structure

- `backend/`: Empty Django project.
- `frontend/`: Empty Next.js app.

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### Frontend

```bash
cd frontend
npm install
# NEXT_PUBLIC_API_BASE_URL defaults to http://localhost:8000/api
npm run dev
```

Visit `http://localhost:3000` in your web browser to run it.

## Deliverables

source code
database migrations
a Django management command that fills the database with dummy data to make manually testing your app easier (suggestion: use the faker Python library)
README describing:
  how to run the project
  how to run tests
  assumptions made
  chosen tradeoffs  
if front-end was implemented, record and share a brief video (max 2 minutes) demonstrating the frontend working end-to-end with the backend.

## Evaluation Criteria

- **Backend (50%)** – API design, database queries performance, appropriate use of Django and Django Rest Framework
- **Frontend (25%)** – UX clarity, filter UX tied to query params, state/data management, handling
  of loading/empty/error cases, and overall polish.
- **Code Quality (15%)** – Code structure, testing where it adds value, documentation/readability, naming
- **Product Thinking (10%)** – Workflow clarity, assumptions noted, and thoughtful UX details (if front-end is implemented)

## Optional Bonus

Authentication using JWT is not required but welcome if time allows.
