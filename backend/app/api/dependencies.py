from __future__ import annotations

from fastapi import Request

from app.services.runtime import RuntimeServices


def get_runtime_services(request: Request) -> RuntimeServices:
    return request.app.state.runtime_services
