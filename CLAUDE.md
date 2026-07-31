# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PI Follow-up Tracker: a web replacement for `PI_Followup_Tracker.xlsx`. Tracks proforma-invoice
follow-ups per vessel/vendor (payment status, invoice attachments, reminders). Stack: **React
(Vite) frontend** + **Python FastAPI/Uvicorn backend** + **PostgreSQL**, invoice files in Azure
Blob Storage, role-gated login (Admin/Editor/Viewer).

## Commands

Backend (from `backend/`, using the venv's own python — no `activate` needed):

```
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8080 --reload
```

Frontend (from `frontend/`):

```
npm run dev      # Vite dev server on :5183, proxies /api/* to :8080
npm run build    # tsc -b && vite build — this IS the type check, there's no separate typecheck script
npm run preview
```

There is no test suite or lint script configured in either project (no `pytest`, no ESLint config,
no test scripts in `package.json`). `npm run build` is the closest thing to CI-equivalent
verification on the frontend.

Seeding reference data (vessels/vendors + one admin user), from `backend/`:

```
.venv\Scripts\python.exe seed.py
```

Migrations: Alembic runs automatically on every backend startup (`run_pending_migrations()` in
`app/main.py` lifespan) — never run `alembic upgrade` manually as a separate step; just restart
uvicorn. When adding a schema change, create the Alembic revision under `backend/alembic/` as
usual; it will be picked up on next startup.

Ports are pinned (not defaults) because other projects on this machine use the standard ones:
backend `8080`, frontend `5183`. Don't "fix" these back to `8000`/`5173`.

## Architecture

### Backend (`backend/app`)

- `core/` — `config.py` (env-driven `Settings`), `security.py` (session cookie auth, bcrypt),
  `enums.py` (Python mirror of `frontend/src/shared/enums.ts` — **keep both in sync by hand**,
  there is no codegen between them).
- `db/` — `session.py` (SQLAlchemy engine/session), `migrate.py` (runs Alembic on startup),
  `base.py` (declarative base).
- `models/` — SQLAlchemy ORM models (`pi_entry.py`, `vessel.py`, `vendor.py`, `user.py`,
  `invoice_attachment.py`, `audit_log.py`, `table_layout_preference.py`).
- `schemas/` — Pydantic request/response types, one file per resource.
- `api/routes/` — one router per resource; `api/router.py` wires them all under `api_router`.
  Auth is a session cookie (`pi_session`, see `api/deps.py`), not JWT/bearer — `get_current_user`
  reads it via `Cookie(...)`, and `require_roles(*roles)` is the role-gate dependency used on
  mutating endpoints.
- `services/` — cross-cutting logic: `audit.py` (writes to the audit log whenever an entry
  changes — see `diff_fields`/`write_audit_log` used in `pi_entries.py`), `blob_storage.py`
  (Azure Blob upload/download for invoice attachments), `importer.py` (Excel import wizard logic).

**`pi_entries.py` is the core resource and deliberately uses raw SQL (`sqlalchemy.text`), not the
ORM query builder**, for its list endpoint — joins against vessels/vendors/users plus a computed
`days_since_payment` (`CURRENT_DATE - pe.payment_date`, live, not stored) and an attachment-count
subquery. Sort columns are whitelisted in `_SORTABLE_COLUMNS` (frontend key → safe SQL expression)
— never interpolate `sort_by` directly into SQL if you extend this. Same pattern for filters:
build `where_clauses`/`params` and bind everything, don't string-format user input into the query.

`seq_no` is a DB-generated `SERIAL` (`FetchedValue()`), matching the original spreadsheet's row
order 1..N — it's the default sort and also what `/pi-entries/{id}/position` computes rank against
(used by the frontend to deep-link to a row's page without applying any filter).

### Frontend (`frontend/src`)

- `pages/` — one per route (`DashboardPage`, `TrackerPage`, `FeedPage`, `admin/*`). Routing lives
  in `App.tsx`: everything under `AppShell` requires `ProtectedRoute`; `/admin/*` is a separate
  layout (`AdminLayout`) also gated by `ProtectedRoute`.
- `components/table/PiEntriesTable.tsx` — the tracker's main grid. Supports inline row edit/add,
  drag-reorderable + resizable columns, and per-user persisted layout (order/widths/page size) via
  `table-layout/pi_entries` (backend: `table_layout_preference.py` model +
  `api/routes/table_layout.py`).
- `components/modals/` — `ImportWizardModal` (Excel import, currently commented out of the
  toolbar in `TrackerPage.tsx` — re-enable by uncommenting the button, not by rebuilding it),
  `AttachmentGalleryModal`, `VesselModal`, `UserModal`, `ChangePasswordModal`.
- `auth/` — `AuthContext` (current user + session), `useRole()` (derives `canEdit` etc. from
  role — Viewer is read-only, Editor/Admin can mutate), `ProtectedRoute`.
- `lib/api.ts` — thin fetch wrapper (`api.get/post/patch/put/delete/postForm`), always
  `credentials: 'include'` for the session cookie, throws `ApiError` with the backend's `detail`
  message.
- `shared/` — **this frontend's own copy** of the enums/types also defined in
  `backend/app/core/enums.py` / `models/`. There is no shared package; when adding/changing an
  enum or a `PiEntry` field, update both sides by hand.

### Tracker page filtering/sorting

`TrackerPage.tsx` builds query params (`search`, `status[]`, `sort_by`, `sort_dir`, `page`,
`page_size`) and the query key includes all of them, so React Query refetches on any change.
`vessel_id` / `vendor_id` filters already exist on the backend (`pi_entries.py` `list_pi_entries`)
but are **not yet wired up in the frontend UI** — only `search` and `status` have toolbar controls
today. `placeholderData: keepPreviousData` is used deliberately so filter/sort/page changes don't
flash the table to a loading state. The entries query also `refetchInterval`s every 5 minutes
purely because `days_since_payment` is computed off `CURRENT_DATE` server-side and a long-open tab
needs to pick up the day rolling over.

### Deployment

See `DEPLOYMENT.md` and `deploy/` (nginx config + systemd unit) — Linux production deploy behind
nginx, backend run via gunicorn/uvicorn workers per `pi-tracker-backend.service`.
