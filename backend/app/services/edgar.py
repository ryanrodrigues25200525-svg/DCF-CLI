from __future__ import annotations

import asyncio
import logging
import math
import time
from functools import wraps
from typing import Any, Dict, List, Optional

import edgar as edgar_lib
import pandas as pd
from edgar import Company, set_identity
from edgar.entity.search import find_company
from edgar.reference.tickers import get_company_tickers

from app.core.cache_versions import profile_key
from app.core.config import settings
from app.core.errors import ResourceNotFound
from app.models.schemas import CompanyProfile
from app.services import cache as cachels

logger = logging.getLogger("sec-service")

try:
    from edgar.entity.core import CompanyNotFoundError as EdgarCompanyNotFoundError
except ImportError:
    EdgarCompanyNotFoundError = None

_PROFILE_INFLIGHT: Dict[str, asyncio.Task] = {}
_PROFILE_INFLIGHT_LOCK = asyncio.Lock()


def init_edgar():
    logger.info("Setting SEC identity to: %s", settings.EDGAR_IDENTITY)
    try:
        set_identity(settings.EDGAR_IDENTITY)
        logger.info("SEC Identity set successfully")
    except Exception as e:
        logger.error("Failed to set SEC identity: %s", e)


init_edgar()


def _is_company_not_found_error(error: Exception) -> bool:
    if EdgarCompanyNotFoundError is not None and isinstance(error, EdgarCompanyNotFoundError):
        return True

    message = str(error).strip().lower()
    return any(
        pattern in message
        for pattern in (
            "company not found",
            "could not find company",
            "no company found",
            "ticker not found",
            "not found in sec database",
        )
    )


def async_retry(retries=3, backoff_in_seconds=1):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            x = 0
            while True:
                try:
                    return await func(*args, **kwargs)
                except asyncio.CancelledError:
                    raise
                except ResourceNotFound:
                    raise
                except Exception as e:
                    if x == retries:
                        raise e
                    sleep = backoff_in_seconds * 2**x
                    logger.warning("Error in %s: %s. Retrying in %ss...", func.__name__, e, sleep)
                    await asyncio.sleep(sleep)
                    x += 1

        return wrapper

    return decorator


@async_retry(retries=3)
async def fetch_company_profile(ticker: str) -> CompanyProfile:
    normalized_ticker = (ticker or "").strip().upper()
    cache_key = profile_key(normalized_ticker)
    cached = await cachels.get_from_cache(cache_key)
    if cached:
        try:
            return CompanyProfile(**cached)
        except Exception:
            logger.warning("Invalid cached profile payload for %s; rebuilding", normalized_ticker)

    async with _PROFILE_INFLIGHT_LOCK:
        in_flight = _PROFILE_INFLIGHT.get(cache_key)
        if in_flight is None:
            in_flight = asyncio.create_task(_build_and_cache_company_profile(normalized_ticker, cache_key))
            _PROFILE_INFLIGHT[cache_key] = in_flight

    try:
        return await asyncio.shield(in_flight)
    finally:
        async with _PROFILE_INFLIGHT_LOCK:
            if _PROFILE_INFLIGHT.get(cache_key) is in_flight:
                _PROFILE_INFLIGHT.pop(cache_key, None)


async def _build_and_cache_company_profile(normalized_ticker: str, cache_key: str) -> CompanyProfile:
    try:
        company = await asyncio.to_thread(Company, normalized_ticker)
    except Exception as exc:
        if _is_company_not_found_error(exc):
            raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database") from exc
        raise

    if company.cik < 0 or str(company.cik).startswith("-") or (company.name and company.name.startswith("Entity -")):
        raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database")

    profile = CompanyProfile(
        cik=str(company.cik).zfill(10),
        ticker=normalized_ticker,
        name=company.name or "Unknown",
        industry=getattr(company, "industry", None),
        fiscal_year_end=getattr(company, "fiscal_year_end", None),
    )

    await cachels.set_to_cache(cache_key, profile.model_dump(), ttl_seconds=6 * 3600)
    return profile


async def search_companies(query: str, limit: int) -> List[Dict[str, str]]:
    normalized_query = (query or "").strip()
    if not normalized_query:
        return []

    safe_limit = max(1, min(int(limit or 10), 50))
    matches: List[Dict[str, str]] = []

    try:
        search_results = await asyncio.to_thread(find_company, normalized_query, safe_limit)
        rows = getattr(search_results, "results", None)
        if rows is not None and not rows.empty:
            for _, row in rows.head(safe_limit).iterrows():
                cik_raw = row.get("cik", "")
                ticker_raw = row.get("ticker", "")
                name_raw = row.get("company", "")
                try:
                    cik_str = str(int(cik_raw)).zfill(10)
                except Exception:
                    cik_str = str(cik_raw or "").zfill(10) if str(cik_raw or "").isdigit() else ""
                matches.append(
                    {
                        "ticker": str(ticker_raw or "").upper(),
                        "name": str(name_raw or ""),
                        "cik": cik_str,
                    }
                )
    except Exception as e:
        logger.warning("edgartools company search failed for query=%s: %s", normalized_query, e)

    if not matches:
        try:
            tickers_df = await asyncio.to_thread(get_company_tickers, True, True, False)
            if normalized_query.isdigit():
                cik_int = int(normalized_query)
                subset = tickers_df[tickers_df["cik"] == cik_int].head(safe_limit)
            else:
                q = normalized_query.upper()
                subset = tickers_df[
                    tickers_df["ticker"].astype(str).str.upper().str.contains(q, na=False)
                    | tickers_df["company"].astype(str).str.upper().str.contains(q, na=False)
                ].head(safe_limit)

            for _, row in subset.iterrows():
                matches.append(
                    {
                        "ticker": str(row.get("ticker", "")).upper(),
                        "name": str(row.get("company", "")),
                        "cik": str(int(row.get("cik", 0))).zfill(10),
                    }
                )
        except Exception as e:
            logger.warning("fallback ticker lookup failed for query=%s: %s", normalized_query, e)

    deduped: List[Dict[str, str]] = []
    seen = set()
    for item in matches:
        key = (item.get("ticker", ""), item.get("cik", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:safe_limit]


def _records_from_statement(statement_obj: Any, statement_type: str = "BalanceSheet") -> List[Dict[str, Any]]:
    if statement_obj is None:
        return []

    if isinstance(statement_obj, pd.DataFrame):
        df = statement_obj.copy()
    elif hasattr(statement_obj, "to_dataframe"):
        try:
            # Prefer the documented export path and keep compatibility fallbacks
            # for older/newer edgartools signatures.
            df = statement_obj.to_dataframe(view="standard")
        except TypeError:
            try:
                df = statement_obj.to_dataframe(standard=True, view="standard")
            except TypeError:
                try:
                    df = statement_obj.to_dataframe(standard=True, include_dimensions=False)
                except TypeError:
                    df = statement_obj.to_dataframe()
    else:
        df = pd.DataFrame(statement_obj)

    if df is None or df.empty:
        return []

    out = df.reset_index(drop=False)
    out.columns = [str(col) for col in out.columns]
    records = out.where(pd.notna(out), None).to_dict(orient="records")
    normalized: List[Dict[str, Any]] = []
    for idx, row in enumerate(records):
        if not isinstance(row, dict):
            continue
        concept_key = str(row.get("standard_concept") or row.get("concept") or row.get("label") or idx)
        row["row_id"] = f"{statement_type}:{concept_key}:{idx}"
        row["statement"] = statement_type
        row["is_missing"] = False
        normalized.append(row)
    return _sanitize_json_value(normalized)


def _sanitize_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _sanitize_json_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_value(v) for v in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


@async_retry(retries=3)
async def fetch_company_financials_native(ticker: str, years: int = 5) -> Dict[str, Any]:
    normalized_ticker = (ticker or "").strip().upper()
    if not normalized_ticker:
        raise ResourceNotFound("Ticker is required")

    try:
        company = await asyncio.to_thread(Company, normalized_ticker)
    except Exception as exc:
        if _is_company_not_found_error(exc):
            raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database") from exc
        raise
    if company.cik < 0 or str(company.cik).startswith("-") or (company.name and company.name.startswith("Entity -")):
        raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database")

    periods = max(1, min(int(years or 5), 10))

    # Parallelize all SEC fetches: statements + key metrics + institution check
    async def _get_financials_safe():
        try:
            financials_obj = await asyncio.to_thread(company.get_financials)
            if not financials_obj:
                return {}
            return {
                "revenue": financials_obj.get_revenue(),
                "net_income": financials_obj.get_net_income(),
                "operating_income": financials_obj.get_operating_income(),
                "total_assets": financials_obj.get_total_assets(),
                "total_liabilities": financials_obj.get_total_liabilities(),
                "stockholders_equity": financials_obj.get_stockholders_equity(),
                "operating_cash_flow": financials_obj.get_operating_cash_flow(),
                "capital_expenditures": financials_obj.get_capital_expenditures(),
                "free_cash_flow": financials_obj.get_free_cash_flow(),
                "shares_outstanding_basic": financials_obj.get_shares_outstanding_basic(),
                "shares_outstanding_diluted": financials_obj.get_shares_outstanding_diluted(),
            }
        except Exception:
            return {}

    income_df, balance_df, cashflow_df, key_metrics, is_fin = await asyncio.gather(
        asyncio.to_thread(
            company.income_statement,
            periods=periods,
            period="annual",
            as_dataframe=False,
        ),
        asyncio.to_thread(
            company.balance_sheet,
            periods=periods,
            period="annual",
            as_dataframe=False,
        ),
        asyncio.to_thread(
            company.cashflow_statement,
            periods=periods,
            period="annual",
            as_dataframe=False,
        ),
        _get_financials_safe(),
        asyncio.to_thread(company.is_financial_institution),
    )

    return _sanitize_json_value(
        {
        "ticker": normalized_ticker,
        "cik": str(company.cik).zfill(10),
        "name": company.name or normalized_ticker,
        "source": "edgartools_native",
        "periods_requested": periods,
        "statements": {
            "income_statement": _records_from_statement(income_df, statement_type="IncomeStatement"),
            "balance_sheet": _records_from_statement(balance_df, statement_type="BalanceSheet"),
            "cashflow_statement": _records_from_statement(cashflow_df, statement_type="CashFlowStatement"),
        },
        "key_metrics": key_metrics,
        "shares_outstanding": getattr(company, "shares_outstanding", None),
        "public_float": getattr(company, "public_float", None),
        "is_financial_institution": is_fin,
        "fiscal_year_end": getattr(company, "fiscal_year_end", None),
        "fetched_at_ms": int(time.time() * 1000),
        }
    )


@async_retry(retries=3)
async def fetch_filings(ticker: str, form: Optional[str] = None, limit: int = 10) -> Dict[str, Any]:
    company = await asyncio.to_thread(edgar_lib.Company, ticker)
    if form:
        filings = await asyncio.to_thread(company.get_filings, form=form.upper())
    else:
        filings = await asyncio.to_thread(company.get_filings)

    if not filings:
        return {
            "ticker": ticker,
            "cik": str(company.cik).zfill(10),
            "filings": [],
        }

    df = filings.to_pandas()
    results = []
    for _, row in df.head(limit).iterrows():
        results.append(
            {
                "form": str(row.get("form", "")),
                "filing_date": str(row.get("filing_date", "")),
                "accession_number": str(row.get("accession_number", "")),
                "period_of_report": str(row.get("period_of_report", "")),
                "url": str(row.get("url", "")),
            }
        )
    return {
        "ticker": ticker,
        "cik": str(company.cik).zfill(10),
        "filings": results,
    }


@async_retry(retries=3)
async def fetch_insider_trades(ticker: str, limit: int = 20) -> List[Dict[str, Any]]:
    try:
        company = await asyncio.to_thread(Company, ticker)
        filings = await asyncio.to_thread(company.get_filings, form="4")

        if not filings:
            return []

        df = filings.to_pandas()
        results = []

        for _, row in df.head(limit).iterrows():
            results.append(
                {
                    "date": str(row.get("filing_date", "")),
                    "owner": str(row.get("reporting_person", row.get("name", "Unknown"))),
                    "type": str(row.get("form", "4")),
                    "shares": 0.0,
                    "price": 0.0,
                    "value": 0.0,
                }
            )

        return results
    except Exception as e:
        logger.error("Failed to fetch insider trades for %s: %s", ticker, e)
        return []
