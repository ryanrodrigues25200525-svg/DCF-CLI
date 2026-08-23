from __future__ import annotations

from typing import Any, Dict, Optional


class AppError(Exception):
    """Base exception for application errors."""
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        code: str = "INTERNAL_ERROR",
        payload: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.payload = payload or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.payload
            }
        }

class ResourceNotFound(AppError):
    def __init__(self, message: str, payload: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=404,
            code="RESOURCE_NOT_FOUND",
            payload=payload
        )
