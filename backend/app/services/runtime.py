from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from app.infrastructure.repository import FinancialRepository, repository
from app.services import edgar, finance
from app.services.excel_export.exporter import export_dcf_excel
from app.models.schemas import CompanyProfile


class SecPort(Protocol):
    def init_edgar(self) -> None: ...
    async def fetch_company_profile(self, ticker: str) -> CompanyProfile: ...
    async def fetch_company_financials_native(self, ticker: str, years: int = 5) -> dict[str, Any]: ...
    async def search_companies(self, query: str, limit: int) -> list[dict[str, Any]]: ...
    async def fetch_filings(self, ticker: str, form: str | None, limit: int) -> dict[str, Any]: ...
    async def fetch_insider_trades(self, ticker: str, limit: int) -> list[dict[str, Any]]: ...


class MarketPort(Protocol):
    async def fetch_market_data(self, ticker: str) -> dict[str, Any]: ...
    def has_usable_market_snapshot(self, data: dict[str, Any]) -> bool: ...


class PeerPort(Protocol):
    async def fetch_peer_data(self, ticker: str) -> list[dict[str, Any]]: ...
    async def fetch_peer_data_bundle(self, ticker: str) -> dict[str, Any]: ...


class MacroPort(Protocol):
    async def fetch_market_context(self) -> dict[str, Any]: ...


class CachePort(Protocol):
    db_path: str

    async def initialize(self) -> None: ...
    async def get(self, key: str) -> Any: ...
    async def set(self, key: str, data: Any, ttl_seconds: int = 3600) -> None: ...
    async def delete_prefix_except(
        self,
        prefix_like: str,
        keep_exact: str | None = None,
        keep_like: str | None = None,
    ) -> int: ...


class WorkbookPort(Protocol):
    def export(self, payload: dict[str, Any]) -> bytes: ...


@dataclass(frozen=True)
class OpenPyXLWorkbookAdapter:
    def export(self, payload: dict[str, Any]) -> bytes:
        return export_dcf_excel(payload)


@dataclass(frozen=True)
class RuntimeServices:
    sec: SecPort
    market: MarketPort
    peers: PeerPort
    macro: MacroPort
    cache: CachePort
    workbook: WorkbookPort


def create_default_runtime_services() -> RuntimeServices:
    return RuntimeServices(
        sec=edgar,
        market=finance,
        peers=finance,
        macro=finance,
        cache=repository,
        workbook=OpenPyXLWorkbookAdapter(),
    )
