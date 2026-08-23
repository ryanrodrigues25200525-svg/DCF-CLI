from __future__ import annotations

NATIVE_FINANCIALS_CACHE_VERSION = "v1"
NATIVE_UNIFIED_CACHE_VERSION = "v1"
MACRO_CACHE_VERSION = "v2"
PEERS_CACHE_VERSION = "v1"

FINANCIALS_TTL_SECONDS = 24 * 60 * 60
MARKET_TTL_SECONDS = 15 * 60
PEERS_TTL_SECONDS = 60 * 60
MACRO_TTL_SECONDS = 24 * 60 * 60


def native_financials_key(ticker: str, years: int) -> str:
    return f"native_fins_{NATIVE_FINANCIALS_CACHE_VERSION}_{ticker.upper()}_{years}"


def native_unified_key(ticker: str, years: int) -> str:
    return f"native_unified_{NATIVE_UNIFIED_CACHE_VERSION}_{ticker.upper()}_{years}"


def profile_key(ticker: str) -> str:
    return f"profile_{ticker.upper()}"


def market_key(ticker: str) -> str:
    return f"market_data_{ticker.upper()}"


def peers_key(ticker: str) -> str:
    return f"peers_{PEERS_CACHE_VERSION}_{ticker.upper()}"


def macro_context_key() -> str:
    return f"macro_context_{MACRO_CACHE_VERSION}"


def macro_treasury_key() -> str:
    return f"macro_treasury_10yr_{MACRO_CACHE_VERSION}"


def macro_market_returns_key() -> str:
    return f"macro_market_returns_{MACRO_CACHE_VERSION}"
