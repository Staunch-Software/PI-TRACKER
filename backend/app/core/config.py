from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000
    environment: str = "development"
    database_url: str
    session_secret: str
    cors_allowed_origin: str = "http://localhost:5183"
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "invoice-attachments"


settings = Settings()
