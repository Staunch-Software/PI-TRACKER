from fastapi import APIRouter

from app.api.routes import (
    attachments,
    audit_log,
    auth,
    dashboard,
    import_export,
    pi_entries,
    table_layout,
    users,
    vendors,
    vessels,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(vessels.router)
api_router.include_router(vendors.router)
api_router.include_router(pi_entries.router)
api_router.include_router(attachments.router)
api_router.include_router(audit_log.router)
api_router.include_router(import_export.router)
api_router.include_router(users.router)
api_router.include_router(dashboard.router)
api_router.include_router(table_layout.router)
