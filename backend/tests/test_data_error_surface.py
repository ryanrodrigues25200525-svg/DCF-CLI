from __future__ import annotations

import asyncio

from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient

from app.main import create_app


def _get(path: str):  # type: ignore[no-untyped-def]
    router = APIRouter()

    @router.get("/boom-data")
    async def boom_data() -> None:
        raise ValueError("Comparable valuation median does not reconcile.")

    @router.get("/boom-unexpected")
    async def boom_unexpected() -> None:
        raise RuntimeError("kaboom")

    app = create_app()
    app.include_router(router)

    async def _run():  # type: ignore[no-untyped-def]
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)

    return asyncio.run(_run())


def test_mapper_value_error_surfaces_reason() -> None:
    response = _get("/boom-data")
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "DATA_ERROR"
    assert body["error"]["reason"] == "Comparable valuation median does not reconcile."
    assert "request_id" in body


def test_unexpected_error_stays_generic_500() -> None:
    response = _get("/boom-unexpected")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "INTERNAL_SERVER_ERROR"
    assert body["error"]["message"] == "An unexpected error occurred. Please try again later."
