from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import export_router, financials_router, macro_router, search
from app.core.cache_versions import macro_context_key
from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import InMemoryRateLimiter
from app.services import cache
from app.services.runtime import RuntimeServices, create_default_runtime_services

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("sec-service")


async def build_general_exception_response(request: Request, exc: Exception) -> JSONResponse:
    """Opaque-by-default 500 with a triage-safe exception kind and request id (#53).

    The message stays generic (no internals leak), but `kind` lets operators
    distinguish an escaped data bug (ValueError) from a runtime failure, and
    `request_id` correlates to the server log line.
    """
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception("Unhandled exception request_id=%s: %s", request_id, str(exc))
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred. Please try again later.",
                "kind": type(exc).__name__,
            },
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


def create_app(services: RuntimeServices | None = None) -> FastAPI:
    runtime_services = services or create_default_runtime_services()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await runtime_services.cache.initialize()
        runtime_services.sec.init_edgar()
        yield

    app = FastAPI(
        title=settings.APP_TITLE,
        description=settings.APP_DESCRIPTION,
        version=settings.APP_VERSION,
        lifespan=lifespan,
    )
    app.state.runtime_services = runtime_services
    rate_limiter = InMemoryRateLimiter(
        limit=settings.RATE_LIMIT_REQUESTS,
        window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
    )

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)
    cors_origins = settings.cors_origins_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        started_at = time.perf_counter()

        def _get_client_ip(req: Request) -> str:
            xff = req.headers.get("x-forwarded-for")
            if xff:
                first = xff.split(",")[0].strip()
                if first:
                    return first
            xri = req.headers.get("x-real-ip")
            if xri and xri.strip():
                return xri.strip()
            return req.client.host if req.client else "unknown"

        if (
            settings.RATE_LIMIT_ENABLED
            and request.url.path not in settings.rate_limit_exempt_paths_list
            and request.url.path.startswith("/api/")
        ):
            client_host = _get_client_ip(request)
            decision = await rate_limiter.check(f"{client_host}:{request.url.path}")
            if not decision.allowed:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "RATE_LIMITED",
                            "message": "Too many requests. Please slow down and try again shortly.",
                        }
                    },
                    headers={
                        "Retry-After": str(decision.retry_after_seconds),
                        "X-RateLimit-Limit": str(decision.limit),
                        "X-RateLimit-Remaining": str(decision.remaining),
                        "X-Request-ID": request_id,
                    },
                )

        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.scheme == "https":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers.setdefault("X-Request-ID", request_id)
        response.headers.setdefault("X-Response-Time-Ms", str(duration_ms))
        if settings.REQUEST_LOG_ENABLED:
            logger.info(
                "request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        request_id = getattr(request.state, "request_id", str(uuid4()))
        return JSONResponse(
            status_code=exc.status_code,
            content={**exc.to_dict(), "request_id": request_id},
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(ValueError)
    async def data_error_handler(request: Request, exc: ValueError):
        request_id = getattr(request.state, "request_id", str(uuid4()))
        reason = str(exc).strip() or "The request data failed backend validation."
        logger.warning("Data error request_id=%s: %s", request_id, reason)
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "DATA_ERROR",
                    "message": reason,
                    "reason": reason,
                },
                "request_id": request_id,
            },
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        return await build_general_exception_response(request, exc)

    app.include_router(financials_router.router, prefix="/api/company", tags=["Company"])
    app.include_router(search.router, prefix="/api/search", tags=["Search"])
    app.include_router(export_router.router, prefix="/api/export", tags=["Export"])
    app.include_router(macro_router.router, prefix="/api/macro", tags=["Macro"])

    @app.get("/")
    async def root() -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": settings.APP_TITLE,
            "version": settings.APP_VERSION,
            "status": "running",
        }
        if settings.EXPOSE_IDENTITY_HINT:
            payload["edgarIdentityConfigured"] = bool(settings.EDGAR_IDENTITY.strip())
        return payload

    @app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

    @app.get("/ready")
    async def readiness_check() -> dict[str, Any]:
        await runtime_services.cache.initialize()
        cache_stats_payload = cache.get_cache_stats(runtime_services.cache)
        warnings: list[str] = []
        if not settings.edgar_identity_configured:
            warnings.append("EDGAR_IDENTITY appears to be using a placeholder value.")
        return {
            "status": "ready",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cache": cache_stats_payload,
            "warnings": warnings,
        }

    @app.get("/api/health")
    async def api_health_check() -> dict[str, Any]:
        macro = await cache.get_from_cache(macro_context_key(), repo=runtime_services.cache)
        return {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cache": cache.get_cache_stats(runtime_services.cache),
            "last_macro_refresh": macro.get("lastUpdated") if isinstance(macro, dict) else None,
        }

    @app.get("/api/cache/stats")
    async def cache_stats() -> dict[str, Any]:
        return cache.get_cache_stats(runtime_services.cache)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", "false").lower() == "true",
    )
