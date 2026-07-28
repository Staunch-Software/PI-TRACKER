import uuid
from datetime import datetime, timedelta, timezone

from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas

from app.core.config import settings

UPLOAD_SAS_MINUTES = 10
DOWNLOAD_SAS_MINUTES = 15

_service_client: BlobServiceClient | None = None


def _get_service_client() -> BlobServiceClient:
    global _service_client
    if _service_client is None:
        _service_client = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
    return _service_client


def build_blob_key(pi_entry_id: uuid.UUID, file_name: str) -> str:
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._- ") or "file"
    return f"pi-entries/{pi_entry_id}/{uuid.uuid4()}-{safe_name}"


def _sas_url(blob_key: str, permission: BlobSasPermissions, expiry_minutes: int) -> str:
    client = _get_service_client()
    container = settings.azure_storage_container
    account_key = client.credential.account_key  # type: ignore[union-attr]
    sas_token = generate_blob_sas(
        account_name=client.account_name,
        container_name=container,
        blob_name=blob_key,
        account_key=account_key,
        permission=permission,
        expiry=datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes),
    )
    blob_client = client.get_blob_client(container=container, blob=blob_key)
    return f"{blob_client.url}?{sas_token}"


def generate_upload_sas_url(blob_key: str) -> str:
    return _sas_url(blob_key, BlobSasPermissions(write=True, create=True), UPLOAD_SAS_MINUTES)


def generate_download_sas_url(blob_key: str) -> str:
    return _sas_url(blob_key, BlobSasPermissions(read=True), DOWNLOAD_SAS_MINUTES)


def ensure_container_exists() -> None:
    client = _get_service_client()
    container_client = client.get_container_client(settings.azure_storage_container)
    if not container_client.exists():
        container_client.create_container()
