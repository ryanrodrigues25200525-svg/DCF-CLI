from __future__ import annotations

import json
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
    )

    APP_TITLE: str = "SEC Data Service"
    APP_DESCRIPTION: str = "REST API for SEC Edgar data using edgartools"
    APP_VERSION: str = "1.3.0"
    LOG_LEVEL: str = "INFO"
    REQUEST_LOG_ENABLED: bool = True

    # Security / Identity
    EDGAR_IDENTITY: str = "DCF Builder User security@example.com"
    EXPOSE_IDENTITY_HINT: bool = False

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1,backend,testserver"
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 120
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_EXEMPT_PATHS: str = "/,/health,/ready,/api/health,/api/cache/stats,/docs,/openapi.json,/redoc"

    @staticmethod
    def _parse_list(raw: Any) -> list[str]:
        if raw is None:
            return []
        if isinstance(raw, list):
            return [str(item).strip() for item in raw if str(item).strip()]
        if isinstance(raw, str):
            value = raw.strip()
            if not value:
                return []
            if value.startswith("[") and value.endswith("]"):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed if str(item).strip()]
                except Exception:
                    pass
            return [item.strip() for item in value.split(",") if item.strip()]
        return [str(raw).strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return self._parse_list(self.CORS_ORIGINS)

    @property
    def allowed_hosts_list(self) -> list[str]:
        return self._parse_list(self.ALLOWED_HOSTS)

    @property
    def rate_limit_exempt_paths_list(self) -> list[str]:
        return self._parse_list(self.RATE_LIMIT_EXEMPT_PATHS)

    @property
    def edgar_identity_configured(self) -> bool:
        identity = self.EDGAR_IDENTITY.strip().lower()
        if not identity:
            return False
        placeholders = {
            "dcf builder user security@example.com",
            "your name your@email.com",
        }
        return identity not in placeholders

settings = Settings()
