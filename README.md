# PI Follow-up Tracker

Replaces `PI_Followup_Tracker.xlsx` with a web app: PostgreSQL-backed tracker, invoice
attachments in Azure Blob Storage, Excel import/export, and a role-gated (Admin/Editor/Viewer)
login. See `.claude/plans/clever-singing-lark.md` (or ask the assistant) for the full design.

Stack: **React (Vite) frontend** + **Python FastAPI/Uvicorn backend** + **PostgreSQL**.

## Prerequisites

- Node.js 20+ (frontend)
- Python 3.12+ (backend — this machine has 3.13, which works fine)
- PostgreSQL 17 running locally (already installed on this machine)

## First-time setup

1. Create the local database (run once, as the `postgres` superuser via pgAdmin or `psql`) if you
   haven't already:

   ```sql
   CREATE USER pi_tracker_app WITH PASSWORD 'choose-a-strong-password-here';
   CREATE DATABASE pi_tracker OWNER pi_tracker_app;
   \c pi_tracker
   CREATE EXTENSION IF NOT EXISTS citext;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   GRANT ALL PRIVILEGES ON DATABASE pi_tracker TO pi_tracker_app;
   ```

2. Copy env files and fill in the real DB password:

   ```
   copy backend\.env.example backend\.env
   copy frontend\.env.example frontend\.env
   ```

   Edit `backend/.env` and set `DATABASE_URL` to
   `postgresql+psycopg2://pi_tracker_app:YOUR_PASSWORD@localhost:5432/pi_tracker`
   (URL-encode any `@` or other special characters in the password, e.g. `@` → `%40`).

3. Set up the backend (from `backend/`):

   ```
   python -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

4. Install frontend dependencies (from `frontend/`):

   ```
   npm install
   ```

5. Seed reference data (vessels/vendors from the source sheet + one admin user). Schema
   migrations run automatically every time the backend starts (see below), so just run:

   ```
   cd backend
   .venv\Scripts\python.exe seed.py
   ```

   The seed script prints the admin login it created (default `admin@ozellar.com` /
   `ChangeMe123!` unless overridden via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars).
   Change this password after first login.

## Running locally

```
cd backend  && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8080 --reload
cd frontend && npm run dev
```

- Backend: `http://localhost:8080` (interactive API docs at `/docs`). Port 8000 is used by another
  project on this machine, so this project is pinned to 8080. Every startup runs any pending
  Alembic migrations automatically — no manual migration step needed.
- Frontend: `http://localhost:5183` (pinned — 5173, Vite's default, is used by another project on
  this machine). Proxies `/api/*` to the backend.

Log in at `http://localhost:5183/login` with the seeded admin credentials to see the full tracker.

## Project layout

- `backend/app` — FastAPI app: `core` (config/security/enums), `db` (SQLAlchemy session, Alembic
  runner), `models` (ORM), `schemas` (Pydantic request/response types), `api/routes` (auth,
  vessels, vendors, pi-entries, audit-log), `services` (audit log writer)
- `backend/alembic` — schema migrations, applied automatically on every backend startup
- `frontend/src` — React app: `pages`, `components/{layout,table,modals}`, `auth`, `lib`,
  `shared` (frontend's own copy of the enums/types also mirrored in `backend/app/core/enums.py`)
- `infra` — Azure Bicep templates (added in Phase 6)
