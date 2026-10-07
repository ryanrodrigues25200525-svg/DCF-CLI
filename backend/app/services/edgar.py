from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from collections import OrderedDict
from functools import wraps
from typing import Any, Dict, List, Optional

import edgar as edgar_lib
import pandas as pd
from bs4 import BeautifulSoup
from edgar import Company, set_identity
from edgar.core import is_probably_html
from edgar.entity.search import find_company
from edgar.reference.tickers import get_company_tickers

from app.core.config import settings
from app.core.errors import ResourceNotFound
from app.models.schemas import CompanyProfile

logger = logging.getLogger("sec-service")

try:
    from edgar.entity.core import CompanyNotFoundError as EdgarCompanyNotFoundError
except ImportError:
    EdgarCompanyNotFoundError = None

_FINANCIALS_INFLIGHT: Dict[tuple[str, int], asyncio.Task] = {}
_FINANCIALS_INFLIGHT_LOCK = asyncio.Lock()
_COMPANY_CACHE_TTL_SECONDS = 15
_COMPANY_CACHE_MAX_ITEMS = 32
_COMPANY_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_COMPANY_INFLIGHT: Dict[str, asyncio.Task] = {}
_COMPANY_INFLIGHT_LOCK = asyncio.Lock()


def init_edgar():
    try:
        set_identity(settings.EDGAR_IDENTITY)
        logger.info("SEC identity configured")
    except Exception:
        logger.error("Failed to configure SEC identity")


init_edgar()


async def _get_company(normalized_ticker: str) -> Any:
    now = time.monotonic()
    async with _COMPANY_INFLIGHT_LOCK:
        cached = _COMPANY_CACHE.get(normalized_ticker)
        if cached is not None:
            expires_at, company = cached
            if expires_at > now:
                _COMPANY_CACHE.move_to_end(normalized_ticker)
                return company
            _COMPANY_CACHE.pop(normalized_ticker, None)

        task = _COMPANY_INFLIGHT.get(normalized_ticker)
        if task is None:
            task = asyncio.create_task(asyncio.to_thread(Company, normalized_ticker))
            _COMPANY_INFLIGHT[normalized_ticker] = task
            task.add_done_callback(lambda finished: _cache_loaded_company(normalized_ticker, finished))
    return await asyncio.shield(task)


def _cache_loaded_company(ticker: str, task: asyncio.Task) -> None:
    if _COMPANY_INFLIGHT.get(ticker) is task:
        _COMPANY_INFLIGHT.pop(ticker, None)
    if task.cancelled() or task.exception() is not None:
        return
    _COMPANY_CACHE[ticker] = (time.monotonic() + _COMPANY_CACHE_TTL_SECONDS, task.result())
    _COMPANY_CACHE.move_to_end(ticker)
    while len(_COMPANY_CACHE) > _COMPANY_CACHE_MAX_ITEMS:
        _COMPANY_CACHE.popitem(last=False)


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
    if not normalized_ticker:
        raise ResourceNotFound("Ticker is required")
    try:
        company = await _get_company(normalized_ticker)
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
        sic=str(getattr(company, "sic", "") or "") or None,
        sic_description=str(getattr(company, "sic_description", "") or "") or None,
        fiscal_year_end=getattr(company, "fiscal_year_end", None),
    )
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


def _normalized_concept(value: Any) -> str:
    concept = str(value or "").split(":")[-1]
    return re.sub(r"[^a-z0-9]", "", concept.lower())


def _finite_reported_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


_ADDITIONAL_CANONICAL_FACTS = {
    "marketablesecuritiescurrent",
    "marketablesecuritiesnoncurrent",
    "shortterminvestments",
    "longterminvestments",
    # Balance-sheet bridge lines that some filings present only in
    # companyfacts (statement-row extraction can omit the row entirely).
    "cashandcashequivalentsatcarryingvalue",
    "cashandcashequivalents",
    "cashcashequivalentsrestrictedcashandrestrictedcashequivalents",
    "longtermdebt",
    "longtermdebtcurrent",
    "longtermdebtnoncurrent",
    "longtermdebtandfinanceleaseobligations",
    "longtermdebtandfinanceleaseobligationscurrent",
    "longtermdebtandfinanceleaseobligationsnoncurrent",
    "longtermdebtandcapitalleaseobligations",
    "longtermdebtandcapitalleaseobligationscurrent",
    "othershorttermborrowings",
    "debtcurrent",
    "shorttermdebt",
    "shorttermborrowings",
    "currentportionoflongtermdebt",
    "minorityinterest",
    "noncontrollinginterest",
    "propertyplantandequipmentnet",
    "paymentstoacquirepropertyplantandequipment",
    "paymentsforpurchaseofpropertyplantandequipment",
    "paymentsforpurchaseofproductiveassets",
    "paymentstoacquireproductiveassets",
    "paymentstoacquireotherpropertyplantandequipment",
    "capitalexpenditures",
    "depreciationdepletionandamortization",
    "depreciationandamortization",
    "depreciation",
    "otherassetscurrent",
    "otherliabilitiescurrent",
    "contractwithcustomerliability",
    "contractwithcustomerliabilitycurrent",
    "availableforsaledebtsecuritiescurrent",
    "availableforsaledebtsecuritiesnoncurrent",
    "weightedaveragenumberofdilutedsharesoutstanding",
    "weightedaveragenumberofsharesoutstandingbasic",
    "commonstocksharesoutstanding",
    "entitycommonstocksharesoutstanding",
    "commercialpaper",
    "preferredstockvalue",
    "preferredstockvalueoutstanding",
    "preferredstockincludingadditionalpaidincapital",
    "preferredstockcarryingvalue",
    "preferredstockincludingadditionalpaidincapitalnetofdiscount",
    "investments",
    "deposits",
    "financingreceivableexcludingaccruedinterestafterallowanceforcreditloss",
    "interestbearingdepositliabilities",
    "interestbearingdepositliabilitiesdomestic",
    "interestbearingdepositliabilitiesforeign",
    "interestbearingdepositsinbanks",
    "investments",
}


def _fetch_source_frames(company: Any, limit: int) -> tuple[pd.DataFrame, list[Dict[str, Any]]]:
    facts = company.get_facts().to_dataframe()
    filings: list[Dict[str, Any]] = []
    for form in ("10-K", "10-K/A"):
        try:
            filing_frame = company.get_filings(form=form).to_pandas()
        except Exception:
            continue
        for row in filing_frame.head(limit).to_dict(orient="records"):
            accession = row.get("accession_number")
            filing_date = row.get("filing_date")
            report_date = row.get("reportDate") or row.get("period_of_report")
            if not accession or not filing_date or not report_date:
                continue
            filings.append({
                "form": str(row.get("form") or form),
                "filing_date": str(filing_date),
                "report_date": str(report_date),
                "accession_number": str(accession),
                "primary_document": str(row.get("primaryDocument") or "") or None,
            })
    filings.sort(key=lambda item: item["filing_date"], reverse=True)
    return facts, filings


def _source_facts_for_statements(
    fact_frame: pd.DataFrame,
    statements: Dict[str, List[Dict[str, Any]]],
    source_filings: list[Dict[str, Any]],
    periods: int,
) -> list[Dict[str, Any]]:
    statement_rows = [row for rows in statements.values() for row in rows]
    years = sorted({
        int(match.group(1))
        for row in statement_rows
        for key in row
        if (match := re.fullmatch(r"FY\s+((?:19|20)\d{2})", str(key)))
    })
    if not years or fact_frame is None or fact_frame.empty:
        return []

    values_by_concept_year: dict[tuple[str, int], list[float]] = {}
    concepts: set[str] = set()
    for row in statement_rows:
        concept = _normalized_concept(row.get("concept") or row.get("standard_concept"))
        if not concept:
            continue
        concepts.add(concept)
        for year in years:
            try:
                value = float(row.get(f"FY {year}"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(value):
                values_by_concept_year.setdefault((concept, year), []).append(value)
    concepts.update(_ADDITIONAL_CANONICAL_FACTS)

    filings_by_year: dict[int, list[Dict[str, Any]]] = {}
    for filing in source_filings:
        try:
            filing_year = int(str(filing["report_date"])[:4])
        except (KeyError, TypeError, ValueError):
            continue
        filings_by_year.setdefault(filing_year, []).append(filing)
    for year_filings in filings_by_year.values():
        year_filings.sort(key=lambda item: item["filing_date"], reverse=True)

    fact_records: list[Dict[str, Any]] = []
    for fact in fact_frame.to_dict(orient="records"):
        concept = _normalized_concept(fact.get("concept"))
        if concept not in concepts or str(fact.get("fiscal_period") or "").upper() != "FY":
            continue
        period_end = str(fact.get("period_end") or "")
        try:
            period_year = int(period_end[:4])
            numeric_value = float(fact.get("numeric_value", fact.get("value")))
        except (TypeError, ValueError):
            continue
        if period_year not in years or not math.isfinite(numeric_value):
            continue
        expected_values = values_by_concept_year.get((concept, period_year), [])
        if expected_values:
            if not any(math.isclose(numeric_value, value, rel_tol=1e-10, abs_tol=0.01) for value in expected_values):
                continue
        elif concept not in _ADDITIONAL_CANONICAL_FACTS:
            continue

        try:
            source_fiscal_year = int(fact.get("fiscal_year"))
        except (TypeError, ValueError):
            source_fiscal_year = period_year
        filing = next(iter(filings_by_year.get(source_fiscal_year, [])), None)
        if filing is None:
            filing = next(iter(filings_by_year.get(period_year, [])), None)
        fact_records.append({
            "concept": str(fact.get("concept") or ""),
            "label": str(fact.get("label") or "") or None,
            "value": numeric_value,
            "unit": str(fact.get("unit") or "") or None,
            "period_end": period_end,
            "fiscal_year": source_fiscal_year,
            "fiscal_period": str(fact.get("fiscal_period") or "FY"),
            "accession_number": filing.get("accession_number") if filing else None,
            "filing_date": filing.get("filing_date") if filing else None,
            "form": filing.get("form") if filing else None,
            "report_date": filing.get("report_date") if filing else None,
            "primary_document": filing.get("primary_document") if filing else None,
        })

    earliest_year = years[max(0, len(years) - periods - 1)]
    return [fact for fact in fact_records if int(str(fact["period_end"])[:4]) >= earliest_year]


def _reported_amount_after_label(line: str, label_pattern: str) -> float | None:
    match = re.match(label_pattern, re.sub(r"\s+", " ", line).strip(), flags=re.IGNORECASE)
    if match is None:
        return None
    tokens = re.findall(r"(?<![A-Za-z0-9.])\(?-?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?", line[match.end():])
    if not tokens:
        return None
    token = tokens[0].replace("$", "").replace(" ", "").replace(",", "")
    negative = token.startswith("(") and token.endswith(")")
    token = token.strip("()")
    try:
        value = float(token)
    except ValueError:
        return None
    return -value if negative else value


def _reported_amounts_after_label(
    line: str,
    label_pattern: str,
    *,
    allow_open_negative_parentheses: bool = False,
) -> list[float]:
    normalized_line = re.sub(r"\s+", " ", line).strip()
    match = re.match(label_pattern, normalized_line, flags=re.IGNORECASE)
    if match is None:
        return []
    tokens = re.findall(r"(?<![A-Za-z0-9.])\(?-?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?", normalized_line[match.end():])
    values: list[float] = []
    for token in tokens:
        raw = token.replace("$", "").replace(" ", "").replace(",", "")
        negative = raw.startswith("(") and (raw.endswith(")") or allow_open_negative_parentheses)
        try:
            amount = float(raw.strip("()"))
        except ValueError:
            continue
        values.append(-amount if negative else amount)
    return values


def _bank_unit_scale(lines: list[str], line_index: int, line: str) -> str | None:
    if re.search(r"\bin\s+billions\b", line, flags=re.IGNORECASE):
        return "billions"
    for previous_line in reversed(lines[max(0, line_index - 120):line_index + 1]):
        if re.search(r"\bin\s+billions\b", previous_line, flags=re.IGNORECASE):
            return "billions"
        if re.search(r"\bin\s+millions\b", previous_line, flags=re.IGNORECASE):
            return "millions"
    return None


def _asset_manager_unit_scale(lines: list[str], line_index: int, line: str) -> str | None:
    candidates = list(reversed(lines[max(0, line_index - 30):line_index + 1]))
    for candidate in candidates:
        if re.search(r"\b(?:in\s+)?thousands\b", candidate, flags=re.IGNORECASE):
            return "thousands"
        if re.search(r"\b(?:in\s+)?millions\b", candidate, flags=re.IGNORECASE):
            return "millions"
        if re.search(r"\b(?:in\s+)?billions\b", candidate, flags=re.IGNORECASE):
            return "billions"
    return None


def _asset_manager_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []

    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []

    def append_fact(
        concept: str,
        label: str,
        value: float,
        year: int,
        scale: str,
        source_statement: str,
        source_components: list[Dict[str, Any]] | None = None,
    ) -> None:
        period_end = f"{year}{report_date[4:]}"
        fact = {
            "concept": concept,
            "label": label,
            "value": value,
            "unit": "USD",
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": source_statement,
        }
        if source_components is not None:
            fact["source_components"] = source_components
        output.append(fact)

    def source_component(concept: str, label: str, value: float, year: int, scale: str, statement: str) -> Dict[str, Any]:
        period_end = f"{year}{report_date[4:]}"
        return {
            "concept": concept,
            "label": label,
            "value": value,
            "unit": "USD",
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": statement,
        }

    aum_heading = next((index for index, line in enumerate(lines) if re.match(
        r"\s*Assets Under Management(?:\s*\(AUM\))?\.?\s*$",
        line,
        flags=re.IGNORECASE,
    )), None)
    aum_table_found = False
    if aum_heading is not None:
        for index in range(aum_heading + 1, min(aum_heading + 90, len(lines))):
            line = re.sub(r"\s+", " ", lines[index]).strip()
            if re.search(r"Component changes in AUM", line, flags=re.IGNORECASE):
                break
            if not re.match(r"Ending AUM\b", line, flags=re.IGNORECASE):
                continue
            amounts = _reported_amounts_after_label(line, r"Ending AUM\b")
            scale = _asset_manager_unit_scale(lines, index, line)
            if len(amounts) < 3 or scale not in {"thousands", "millions", "billions"}:
                continue
            for offset, amount in enumerate(amounts[:5]):
                if amount > 0:
                    append_fact(
                        "AssetManagerAum",
                        "Year-end assets under management",
                        amount,
                        report_year - offset,
                        scale,
                        "SEC 10-K Assets Under Management table, Ending AUM row",
                    )
            aum_table_found = True
            break

    if not aum_table_found and aum_heading is not None:
        for index in range(aum_heading + 1, min(aum_heading + 90, len(lines))):
            line = re.sub(r"\s+", " ", lines[index]).strip()
            if re.search(r"Component changes in AUM", line, flags=re.IGNORECASE):
                break
            if not re.match(r"Total\s+\$?\s*(?:\d|\()", line, flags=re.IGNORECASE):
                continue
            amounts = _reported_amounts_after_label(line, r"Total\b")
            scale = _asset_manager_unit_scale(lines, index, line)
            if len(amounts) < 3 or scale not in {"thousands", "millions", "billions"}:
                continue
            for offset, amount in enumerate(amounts[:5]):
                if amount > 0:
                    append_fact(
                        "AssetManagerAum",
                        "Year-end assets under management",
                        amount,
                        report_year - offset,
                        scale,
                        "SEC 10-K Assets Under Management table, Total row",
                    )
            aum_table_found = True
            break

    if not aum_table_found and not any(fact["concept"] == "AssetManagerAum" and fact["fiscal_year"] == report_year for fact in output):
        filing_text_flat = re.sub(r"\s+", " ", filing_text)
        aum_change = re.search(
            r"At\s+December\s+31,\s*(?P<year>20\d{2}).{0,250}?"
            r"\$?\s*(?P<current>[\d,]+(?:\.\d+)?)\s*(?P<current_unit>trillion|billion|million)\s+in assets under management"
            r".{0,180}?(?P<direction>increase|decrease)\s+of\s+\$?\s*(?P<change>[\d,]+(?:\.\d+)?)\s*"
            r"(?P<change_unit>trillion|billion|million).*?from the end of\s*(?P<prior>20\d{2})",
            filing_text_flat,
            flags=re.IGNORECASE,
        )
        if aum_change is not None:
            current_value = float(aum_change.group("current").replace(",", ""))
            current_unit = aum_change.group("current_unit").lower()
            change_value = float(aum_change.group("change").replace(",", ""))
            change_unit = aum_change.group("change_unit").lower()

            def in_billions(value: float, unit: str) -> float:
                return value * 1000.0 if unit == "trillion" else value / 1000.0 if unit == "million" else value

            current_billions = in_billions(current_value, current_unit)
            change_billions = in_billions(change_value, change_unit)
            prior_year = int(aum_change.group("prior"))
            direction = aum_change.group("direction").lower()
            prior_billions = current_billions - change_billions if direction == "increase" else current_billions + change_billions
            source_year = int(aum_change.group("year"))
            source_period_end = f"{source_year}{report_date[4:]}"
            source_metadata = {
                "unit": "USD",
                "unit_scale": "billions",
                "period_end": source_period_end,
                "fiscal_year": source_year,
                "fiscal_period": "FY",
                "accession_number": accession_number,
                "filing_date": filing_date,
                "form": form,
                "report_date": source_period_end,
                "primary_document": primary_document,
            }
            current_aum_source = {
                **source_metadata,
                "concept": "ReportedCurrentYearEndAum",
                "label": "Reported current year-end AUM",
                "value": current_billions,
                "source_statement": "SEC 10-K AUM narrative, reported current year-end amount",
            }
            aum_change_source = {
                **source_metadata,
                "concept": "ReportedAnnualAumChange",
                "label": f"Reported year-over-year AUM {direction}",
                "value": change_billions,
                "source_statement": f"SEC 10-K AUM narrative, reported annual {direction}",
            }
            append_fact(
                "AssetManagerAum",
                "Year-end assets under management",
                current_billions,
                source_year,
                "billions",
                "SEC 10-K AUM narrative, reported year-end amount normalized to USD billions",
                [current_aum_source],
            )
            append_fact(
                "AssetManagerAum",
                "Prior year-end assets under management",
                prior_billions,
                prior_year,
                "billions",
                f"SEC 10-K AUM narrative; derived as current AUM less reported {direction} of {change_value} {change_unit}",
                [current_aum_source, aum_change_source],
            )

    bridge_priority = {
        "client region": 0,
        "client type and product type": 1,
        "product type": 2,
        "investment style and product type": 3,
    }
    bridge_headings: dict[int, tuple[int, int, str]] = {}
    for index, line in enumerate(lines):
        match = re.search(
            r"Component changes in AUM by (?P<group>client region|client type and product type|product type|investment style and product type)\s+for\s+(?P<year>20\d{2})",
            line,
            flags=re.IGNORECASE,
        )
        if match is None:
            continue
        group = re.sub(r"\s+", " ", match.group("group").lower())
        year = int(match.group("year"))
        candidate = (bridge_priority[group], index, group)
        if year not in bridge_headings or candidate[0] < bridge_headings[year][0]:
            bridge_headings[year] = candidate

    for bridge_year, (_priority, heading_index, bridge_group) in bridge_headings.items():
        for index in range(heading_index + 1, min(heading_index + 250, len(lines))):
            line = re.sub(r"\s+", " ", lines[index]).strip()
            if not re.match(r"Total\b", line, flags=re.IGNORECASE):
                continue
            # EDGAR plain text drops some closing parentheses in these inline-XBRL tables.
            amounts = _reported_amounts_after_label(
                line,
                r"Total\b",
                allow_open_negative_parentheses=True,
            )
            scale = _asset_manager_unit_scale(lines, index, line)
            if len(amounts) != 7 or scale not in {"thousands", "millions", "billions"}:
                continue

            tolerance = 2.0 if scale == "millions" else 0.002 if scale == "billions" else 2_000.0
            if abs(sum(amounts[:-1]) - amounts[-1]) <= tolerance:
                opening_aum, net_flows, realizations, acquisitions, market_change, fx_change, ending_aum = amounts
                components = [
                    ("AssetManagerNetFlows", "Net flows", net_flows),
                    ("AssetManagerRealizations", "Realizations", realizations),
                    ("AssetManagerAcquisitions", "Acquisitions", acquisitions),
                    ("AssetManagerMarketChange", "Market change", market_change),
                    ("AssetManagerFxChange", "FX impact", fx_change),
                ]
            elif abs(sum(amounts[:5]) - amounts[5]) <= tolerance:
                opening_aum, net_flows, acquisitions, market_change, fx_change, ending_aum, _average_aum = amounts
                realizations = None
                components = [
                    ("AssetManagerNetFlows", "Net flows", net_flows),
                    ("AssetManagerAcquisitions", "Acquisitions", acquisitions),
                    ("AssetManagerMarketChange", "Market change", market_change),
                    ("AssetManagerFxChange", "FX impact", fx_change),
                ]
            else:
                continue

            source_table = f"SEC 10-K AUM change by {bridge_group}, Total row"
            for concept, label, value in components:
                append_fact(concept, label, value, bridge_year, scale, f"{source_table}; reported {label.lower()}")
            scope_change = ending_aum - opening_aum - sum(value for _concept, _label, value in components)
            source_components = [
                source_component("ReportedBeginningAum", "Reported beginning AUM", opening_aum, bridge_year - 1, scale, source_table),
                *[
                    source_component(f"Reported{concept.removeprefix('AssetManager')}", label, value, bridge_year, scale, f"{source_table}; reported {label.lower()}")
                    for concept, label, value in components
                ],
                source_component("ReportedEndingAum", "Reported ending AUM", ending_aum, bridge_year, scale, source_table),
            ]
            append_fact(
                "AssetManagerScopeChange",
                "Unclassified AUM change after reported bridge components",
                scope_change,
                bridge_year,
                scale,
                f"{source_table}; derived as ending AUM less beginning AUM and reported movement components",
                source_components,
            )
            break

    trow_bridge_heading = next((index for index, line in enumerate(lines) if re.search(
        r"The following table details changes in our assets under management,\s*by asset class",
        line,
        flags=re.IGNORECASE,
    )), None)
    if trow_bridge_heading is not None:
        opening_year: int | None = None
        opening_aum: float | None = None
        opening_scale: str | None = None
        movement_values: Dict[str, float] = {}
        movement_labels: Dict[str, str] = {}
        movement_sources: Dict[str, str] = {}

        def finish_trow_bridge(year: int, ending_aum: float, scale: str) -> None:
            if opening_year is None or opening_aum is None or year != opening_year + 1:
                return
            net_flows_value = movement_values.get("AssetManagerNetFlows")
            market_change_value = movement_values.get("AssetManagerMarketChange")
            if net_flows_value is None or market_change_value is None:
                return
            append_fact(
                "AssetManagerNetFlows",
                movement_labels["AssetManagerNetFlows"],
                net_flows_value,
                year,
                scale,
                movement_sources["AssetManagerNetFlows"],
            )
            append_fact(
                "AssetManagerMarketChange",
                movement_labels["AssetManagerMarketChange"],
                market_change_value,
                year,
                scale,
                movement_sources["AssetManagerMarketChange"],
            )
            scope_change = movement_values.get("AssetManagerScopeChange")
            if scope_change is not None:
                append_fact(
                    "AssetManagerScopeChange",
                    movement_labels["AssetManagerScopeChange"],
                    scope_change,
                    year,
                    scale,
                    movement_sources["AssetManagerScopeChange"],
                )
                return
            residual = ending_aum - opening_aum - net_flows_value - market_change_value
            decimals = 1 if scale == "billions" else 0
            rounding_tolerance = 4 * 0.5 * (10 ** -decimals)
            if not math.isfinite(residual) or abs(residual) > rounding_tolerance:
                return
            source_statement = (
                "SEC 10-K AUM rollforward table; derived as ending AUM less beginning AUM, "
                "net cash flows, and market appreciation, within displayed rounding"
            )
            components = [
                source_component("ReportedBeginningAum", "Reported beginning AUM", opening_aum, opening_year, scale, "SEC 10-K AUM rollforward table, beginning balance row"),
                source_component("ReportedEndingAum", "Reported ending AUM", ending_aum, year, scale, "SEC 10-K AUM rollforward table, ending balance row"),
                source_component("ReportedNetCashFlows", "Reported net cash flows", net_flows_value, year, scale, movement_sources["AssetManagerNetFlows"]),
                source_component("ReportedNetMarketAppreciation", "Reported net market appreciation and income", market_change_value, year, scale, movement_sources["AssetManagerMarketChange"]),
            ]
            append_fact(
                "AssetManagerScopeChange",
                "Other AUM scope change",
                residual,
                year,
                scale,
                source_statement,
                components,
            )

        for index in range(trow_bridge_heading + 1, min(trow_bridge_heading + 100, len(lines))):
            line = re.sub(r"\s+", " ", lines[index]).strip()
            opening_pattern = r"Assets under management at December 31,\s*(?P<year>20\d{2})\b"
            opening_match = re.match(opening_pattern, line, flags=re.IGNORECASE)
            if opening_match is not None:
                amounts = _reported_amounts_after_label(line, r"Assets under management at December 31,\s*20\d{2}\b")
                row_scale = _asset_manager_unit_scale(lines, index, line)
                if not amounts or row_scale not in {"thousands", "millions", "billions"}:
                    continue
                row_year = int(opening_match.group("year"))
                row_aum = amounts[-1]
                if opening_year is not None:
                    finish_trow_bridge(row_year, row_aum, row_scale)
                opening_year = row_year
                opening_aum = row_aum
                opening_scale = row_scale
                movement_values = {}
                movement_labels = {}
                movement_sources = {}
                continue
            if opening_year is None or opening_scale is None:
                continue

            flow_pattern = r"Net cash flows\b"
            if re.match(r"Net cash flows(?!\s+prior to manager-driven distributions)\b", line, flags=re.IGNORECASE):
                amounts = _reported_amounts_after_label(line, flow_pattern)
                if amounts:
                    movement_values["AssetManagerNetFlows"] = amounts[-1]
                    movement_labels["AssetManagerNetFlows"] = "Net cash flows"
                    movement_sources["AssetManagerNetFlows"] = "SEC 10-K AUM rollforward table, Net cash flows row"
                continue
            market_pattern = r"Net market appreciation \(depreciation\) and income(?:\s+\(\d+\))?"
            if re.match(market_pattern, line, flags=re.IGNORECASE):
                amounts = _reported_amounts_after_label(line, market_pattern)
                if amounts:
                    movement_values["AssetManagerMarketChange"] = amounts[-1]
                    movement_labels["AssetManagerMarketChange"] = "Net market appreciation and income"
                    movement_sources["AssetManagerMarketChange"] = "SEC 10-K AUM rollforward table, net market appreciation and income row"
                continue
            scope_pattern = r"Managed account\s*-\s*model delivery assets(?:\s+\(\d+\))?"
            if re.match(scope_pattern, line, flags=re.IGNORECASE):
                amounts = _reported_amounts_after_label(line, scope_pattern)
                if amounts:
                    movement_values["AssetManagerScopeChange"] = amounts[-1]
                    movement_labels["AssetManagerScopeChange"] = "Managed account model delivery assets"
                    movement_sources["AssetManagerScopeChange"] = "SEC 10-K AUM rollforward table, managed account model delivery assets row"

    cashflow_start_candidates = [index for index, line in enumerate(lines) if re.match(
        r"(?:Cash flows from )?operating activities\b",
        re.sub(r"\s+", " ", line).strip(),
        flags=re.IGNORECASE,
    ) and any(re.match(r"Net income\b", re.sub(r"\s+", " ", following).strip(), flags=re.IGNORECASE)
        for following in lines[index + 1:min(index + 8, len(lines))])]
    cashflow_start = cashflow_start_candidates[-1] if cashflow_start_candidates else None
    if cashflow_start is not None:
        cashflow_end = next((index for index in range(cashflow_start + 1, min(cashflow_start + 70, len(lines)))
            if re.match(r"Net cash .*operating activities", re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)), None)
        if cashflow_end is not None:
            cashflow_rows = (
                (
                    "AssetManagerDepreciation",
                    r"Depreciation(?:, amortization and impairments? of property, equipment and software| and amortization)\b",
                    "Depreciation and amortization",
                ),
                (
                    "AssetManagerAcquisitionAmortization",
                    r"Amortization and impairment of acquisition-related assets and retention arrangements\b",
                    "Acquisition-related amortization and impairment",
                ),
            )
            for concept, pattern, label in cashflow_rows:
                for index in range(cashflow_start, cashflow_end):
                    line = re.sub(r"\s+", " ", lines[index]).strip()
                    if not re.match(pattern, line, flags=re.IGNORECASE):
                        continue
                    amounts = _reported_amounts_after_label(line, pattern)
                    scale = _asset_manager_unit_scale(lines, index, line)
                    if len(amounts) < 3 or scale not in {"thousands", "millions", "billions"}:
                        continue
                    for offset, amount in enumerate(amounts[:3]):
                        append_fact(
                            concept,
                            label,
                            amount,
                            report_year - offset,
                            scale,
                            f"SEC 10-K Consolidated Statements of Cash Flows, {label} row",
                        )
                    break

            other_changes_pattern = r"Other changes in assets and liabilities\b"
            other_changes_row = next((
                (index, re.sub(r"\s+", " ", lines[index]).strip())
                for index in range(cashflow_start, cashflow_end)
                if re.match(other_changes_pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)
            ), None)
            if other_changes_row is not None:
                row_index, row = other_changes_row
                amounts = _reported_amounts_after_label(row, other_changes_pattern)
                scale = _asset_manager_unit_scale(lines, row_index, row)
                if len(amounts) >= 3 and scale in {"thousands", "millions", "billions"}:
                    for offset, cash_impact in enumerate(amounts[:3]):
                        fiscal_year = report_year - offset
                        statement = (
                            "SEC 10-K Consolidated Statements of Cash Flows, Other changes in assets and liabilities row; "
                            "derived as the negative of reported cash impact to present investment in operating working capital"
                        )
                        component = source_component(
                            "ReportedOtherChangesInAssetsAndLiabilities",
                            "Reported cash impact from other changes in assets and liabilities",
                            cash_impact,
                            fiscal_year,
                            scale,
                            "SEC 10-K Consolidated Statements of Cash Flows, Other changes in assets and liabilities row",
                        )
                        append_fact(
                            "AssetManagerWorkingCapitalChange",
                            "Change in operating working capital and other operating assets/liabilities",
                            -cash_impact,
                            fiscal_year,
                            scale,
                            statement,
                            [component],
                        )
            else:
                other_adjustments_index = next((index for index in range(cashflow_start, cashflow_end)
                    if re.fullmatch(r"Other adjustments", re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)), None)
                operating_change_rows = (
                    ("AccountsReceivableCashImpact", r"Accounts receivable\b", "Accounts receivable"),
                    ("TradingInvestmentsCashImpact", r"Investments, trading\b", "Investments, trading"),
                    ("OtherOperatingAssetsCashImpact", r"Other assets\b", "Other assets"),
                    ("AccruedCompensationCashImpact", r"Accrued compensation and benefits\b", "Accrued compensation and benefits"),
                    ("AccountsPayableCashImpact", r"Accounts payable and accrued liabilities\b", "Accounts payable and accrued liabilities"),
                    ("OtherOperatingLiabilitiesCashImpact", r"Other liabilities\b", "Other liabilities"),
                )
                if other_adjustments_index is not None:
                    cash_impacts: dict[int, float] = {}
                    impact_components: dict[int, list[Dict[str, Any]]] = {}
                    for concept, pattern, label in operating_change_rows:
                        match = next((
                            (index, re.sub(r"\s+", " ", lines[index]).strip())
                            for index in range(other_adjustments_index + 1, cashflow_end)
                            if re.match(pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)
                        ), None)
                        if match is None:
                            continue
                        row_index, row = match
                        amounts = _reported_amounts_after_label(
                            row,
                            pattern,
                            allow_open_negative_parentheses=True,
                        )
                        scale = _asset_manager_unit_scale(lines, row_index, row)
                        if len(amounts) < 3 or scale not in {"thousands", "millions", "billions"}:
                            continue
                        for offset, cash_impact in enumerate(amounts[:3]):
                            fiscal_year = report_year - offset
                            cash_impacts[fiscal_year] = cash_impacts.get(fiscal_year, 0.0) + cash_impact
                            impact_components.setdefault(fiscal_year, []).append(source_component(
                                concept,
                                f"Reported cash impact: {label}",
                                cash_impact,
                                fiscal_year,
                                scale,
                                f"SEC 10-K Consolidated Statements of Cash Flows, Other adjustments, {label} row",
                            ))
                    for fiscal_year, cash_impact in cash_impacts.items():
                        append_fact(
                            "AssetManagerWorkingCapitalChange",
                            "Change in operating working capital and other operating assets/liabilities",
                            -cash_impact,
                            fiscal_year,
                            "millions",
                            "SEC 10-K Consolidated Statements of Cash Flows, Other adjustments; derived as the negative of reported asset/liability cash impacts to present investment in operating working capital",
                            impact_components[fiscal_year],
                        )

    capital_allocation_heading = next((index for index, line in enumerate(lines) if re.fullmatch(
        r"Capital allocation-based income",
        re.sub(r"\s+", " ", line).strip(),
        flags=re.IGNORECASE,
    )), None)
    if capital_allocation_heading is not None:
        capital_components: dict[str, tuple[str, str, list[float], str]] = {}
        for concept, pattern, label in (
            ("ReportedChangeInAccruedCarriedInterest", r"Change in accrued carried interest\b", "Change in accrued carried interest"),
            ("ReportedAcquisitionRelatedAmortization", r"Acquisition-related amortization and impairments\b", "Acquisition-related amortization and impairments"),
        ):
            for index in range(capital_allocation_heading + 1, min(capital_allocation_heading + 8, len(lines))):
                line = re.sub(r"\s+", " ", lines[index]).strip()
                if not re.match(pattern, line, flags=re.IGNORECASE):
                    continue
                amounts = _reported_amounts_after_label(line, pattern, allow_open_negative_parentheses=True)
                scale = _asset_manager_unit_scale(lines, index, line)
                if len(amounts) >= 3 and scale in {"thousands", "millions", "billions"}:
                    capital_components[concept] = (label, scale, amounts[:3], line)
                break
        carry = capital_components.get("ReportedChangeInAccruedCarriedInterest")
        amortization = capital_components.get("ReportedAcquisitionRelatedAmortization")
        if carry is not None and amortization is not None and carry[1] == amortization[1]:
            for offset in range(3):
                fiscal_year = report_year - offset
                carry_value = carry[2][offset]
                amortization_value = amortization[2][offset]
                source_statement = (
                    "SEC 10-K MD&A capital allocation-based income table; derived as change in accrued carried interest "
                    "plus acquisition-related amortization and impairment adjustments"
                )
                components = [
                    source_component(carry[0], carry[0], carry_value, fiscal_year, carry[1], "SEC 10-K MD&A capital allocation-based income table, accrued carried interest row"),
                    source_component(amortization[0], amortization[0], amortization_value, fiscal_year, amortization[1], "SEC 10-K MD&A capital allocation-based income table, acquisition amortization and impairments row"),
                ]
                append_fact(
                    "AssetManagerCapitalAllocationIncome",
                    "Capital allocation-based income",
                    carry_value + amortization_value,
                    fiscal_year,
                    carry[1],
                    source_statement,
                    components,
                )

    fee_specs = (
        ("AssetManagerBaseFees", r"(?:Investment advisory and administration fees|Investment advisory fees)\b", "Investment advisory and administration fees"),
        ("AssetManagerPerformanceFees", r"(?:Total investment advisory performance fees|Performance-based advisory fees)\b", "Investment advisory performance fees"),
        ("AssetManagerSecuritiesLendingRevenue", r"Securities lending revenue\b", "Securities lending revenue"),
        ("AssetManagerTechnologyRevenue", r"Technology services and subscription revenue\b", "Technology services and subscription revenue"),
        ("AssetManagerDistributionRevenue", r"(?:Distribution and servicing fees|Distribution fees)\b", "Distribution and servicing fees"),
        ("AssetManagerAdministrativeOtherRevenue", r"Administrative and other fees\b", "Administrative and other fees"),
        ("AssetManagerOtherRevenue", r"Advisory and other revenue\b", "Advisory and other revenue"),
    )
    for concept, pattern, label in fee_specs:
        for index, original_line in enumerate(lines):
            line = re.sub(r"\s+", " ", original_line).strip()
            if not re.match(pattern, line, flags=re.IGNORECASE):
                continue
            amounts = _reported_amounts_after_label(line, pattern)
            scale = _asset_manager_unit_scale(lines, index, line)
            if len(amounts) < 3 or scale not in {"thousands", "millions", "billions"}:
                continue
            for offset, amount in enumerate(amounts[:3]):
                append_fact(
                    concept,
                    label,
                    amount,
                    report_year - offset,
                    scale,
                    "SEC 10-K consolidated fee-revenue table",
                )
            break



def _sgml_html_text(filing: Any, width: int = 500) -> str | None:
    """Render filing text from SGML-derived HTML, bypassing the homepage index.

    Installed edgartools (>=5.36.0 observed) `Filing.html()`/`text()` dereference
    `homepage.primary_html_document` without a None guard; recent 10-K filings
    whose homepage index carries zero documents raise
    `AttributeError: 'NoneType' object has no attribute 'download'`. The SGML
    payload itself is intact, so parse it directly with the same HTMLParser +
    rich_to_text pipeline `Filing.text()` uses.
    """
    try:
        html_content = filing.sgml().html()
    except Exception:
        return None
    if not html_content or not is_probably_html(html_content):
        return None
    try:
        from edgar.documents import HTMLParser, ParserConfig
        from edgar.richtools import rich_to_text
        parser = HTMLParser(ParserConfig(form=getattr(filing, "form", None)))
        document = parser.parse(html_content)
        if document is not None and not document.is_empty:
            return rich_to_text(document, width=width)
    except Exception:
        return None
    return None


def _resilient_filing_text(filing: Any) -> str:
    """Filing body text that survives the edgartools homepage-index drift."""
    try:
        return filing.text()
    except Exception:
        fallback = _sgml_html_text(filing)
        if fallback:
            return fallback
        raise


def _resilient_filing_html(filing: Any) -> str | None:
    """Primary-document HTML that survives the edgartools homepage-index drift."""
    try:
        html = filing.html()
    except Exception:
        html = None
    if html:
        return html
    try:
        html_content = filing.sgml().html()
    except Exception:
        return html
    return html_content or html



def _bank_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []

    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []

    def add_row_fact(concept: str, label_pattern: str, *, required_context: str | None = None) -> bool:
        for index, original_line in enumerate(lines):
            line = re.sub(r"\s+", " ", original_line).strip()
            if not re.match(label_pattern, line, flags=re.IGNORECASE):
                continue
            context = " ".join(lines[max(0, index - 35):index + 1]).lower()
            if required_context and required_context.lower() not in context:
                continue
            value = _reported_amount_after_label(line, label_pattern)
            scale = _bank_unit_scale(lines, index, line)
            if value is None or scale is None:
                continue
            output.append({
                "concept": concept,
                "label": re.match(label_pattern, line, flags=re.IGNORECASE).group(0).strip(),
                "value": value,
                "unit": "USD",
                "unit_scale": scale,
                "period_end": report_date,
                "fiscal_year": report_year,
                "fiscal_period": "FY",
                "accession_number": accession_number,
                "filing_date": filing_date,
                "form": form,
                "report_date": report_date,
                "primary_document": primary_document,
                "source_statement": "SEC 10-K table",
            })
            return True
        return False

    add_row_fact("BankNoninterestIncome", r"(?:Total )?Noninterest (?:income|revenue)\b")
    add_row_fact("BankNoninterestExpense", r"(?:Total )?Noninterest expense\b")
    add_row_fact("BankProvisionForCreditLosses", r"Provision for credit losses\b")
    add_row_fact("BankAverageInterestEarningAssets", r"Total (?:interest-earning|earning) assets\b")
    add_row_fact("BankAverageInterestBearingLiabilities", r"Total interest-bearing liabilities\b")

    for concept, label_pattern in (
        ("BankNoninterestIncome", r"(?:Total )?Noninterest (?:income|revenue)\b"),
        ("BankNoninterestExpense", r"(?:Total )?Noninterest expense\b"),
        ("BankProvisionForCreditLosses", r"Provision for credit losses\b"),
    ):
        for index, original_line in enumerate(lines):
            line = re.sub(r"\s+", " ", original_line).strip()
            if not re.match(label_pattern, line, flags=re.IGNORECASE):
                continue
            header_line = next((
                previous_line for previous_line in reversed(lines[max(0, index - 10):index])
                if re.search(r"(?:19|20)\d{2}", previous_line)
            ), "")
            header_years = [int(item) for item in re.findall(r"\b((?:19|20)\d{2})\b", header_line)]
            if header_years[:3] != [report_year, report_year - 1, report_year - 2]:
                continue
            amounts = _reported_amounts_after_label(line, label_pattern)
            scale = _bank_unit_scale(lines, index, line)
            if scale is None and amounts:
                corroborating_fact = next((
                    fact for fact in output
                    if fact.get("concept") == concept
                    and fact.get("fiscal_year") == report_year
                    and math.isclose(float(fact.get("value")), amounts[0], rel_tol=1e-10, abs_tol=0.01)
                    and fact.get("unit") == "USD"
                    and fact.get("unit_scale") in {"millions", "billions"}
                ), None)
                if corroborating_fact is not None:
                    scale = str(corroborating_fact["unit_scale"])
            if len(amounts) < 3 or scale is None:
                continue
            for offset, amount in enumerate(amounts[:3]):
                fiscal_year = report_year - offset
                output.append({
                    "concept": concept,
                    "label": re.match(label_pattern, line, flags=re.IGNORECASE).group(0).strip(),
                    "value": amount,
                    "unit": "USD",
                    "unit_scale": scale,
                    "period_end": f"{fiscal_year}{report_date[4:]}",
                    "fiscal_year": fiscal_year,
                    "fiscal_period": "FY",
                    "accession_number": accession_number,
                    "filing_date": filing_date,
                    "form": form,
                    "report_date": f"{fiscal_year}{report_date[4:]}",
                    "primary_document": primary_document,
                    "source_statement": "SEC 10-K selected income statement data",
                })
            break

    declared_dividend_candidates: list[tuple[int, str, float, str]] = []
    for marker_index, marker_line in enumerate(lines):
        if not re.search(r"^\s*Dividends declared\s*:", marker_line, flags=re.IGNORECASE):
            continue
        for row_index in range(marker_index + 1, min(len(lines), marker_index + 4)):
            line = re.sub(r"\s+", " ", lines[row_index]).strip()
            value = _reported_amount_after_label(line, r"Common\b")
            scale = _bank_unit_scale(lines, row_index, line)
            if value is not None and scale is not None:
                declared_dividend_candidates.append((row_index, line, value, scale))
                break
    for offset, (_row_index, line, value, scale) in enumerate(
        sorted(declared_dividend_candidates, key=lambda item: item[0])[-3:]
    ):
        fiscal_year = report_year - (min(3, len(declared_dividend_candidates)) - 1 - offset)
        period_end = f"{fiscal_year}{report_date[4:]}"
        output.append({
            "concept": "BankCommonDividendsDeclared",
            "label": "Common dividends declared",
            "value": value,
            "unit": "USD",
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": fiscal_year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": "SEC 10-K statement of changes in stockholders' equity",
        })

    cet1_requirement: float | None = None
    cet1_requirement_label = ""
    cet1_requirement_statement = ""
    for index, original_line in enumerate(lines):
        line = re.sub(r"\s+", " ", original_line).strip()
        if not re.match(r"(?:CET1|Common equity tier 1) capital\b(?!\s+ratio)", line, flags=re.IGNORECASE):
            continue
        preceding = " ".join(lines[max(0, index - 12):index]).lower()
        if "capital ratio requirements" not in preceding or "risk-based capital ratios" not in preceding:
            continue
        cet1_requirement = _reported_amount_after_label(line, r"(?:CET1|Common equity tier 1) capital\b(?!\s+ratio)")
        if cet1_requirement is not None:
            cet1_requirement_label = "CET1 capital ratio requirement (standardized BHC)"
            cet1_requirement_statement = "SEC 10-K standardized capital ratio requirements table"
            break

    if cet1_requirement is None:
        for marker_index, marker_line in enumerate(lines):
            if not re.search(r"Risk-based capital metrics", marker_line, flags=re.IGNORECASE):
                continue
            context = " ".join(lines[max(0, marker_index - 8):marker_index + 28]).lower()
            if "regulatory minimum" not in context:
                continue
            header_text = " ".join(lines[max(0, marker_index - 8):marker_index])
            header_years = re.findall(r"(?:December|March|June|September)\s+\d{1,2},\s+((?:19|20)\d{2})", header_text, flags=re.IGNORECASE)
            if not header_years or int(header_years[-1]) != report_year:
                continue
            for original_line in lines[marker_index:marker_index + 28]:
                line = re.sub(r"\s+", " ", original_line).strip()
                label_pattern = r"(?:Common equity tier 1|CET1) capital ratio\b"
                amounts = _reported_amounts_after_label(line, label_pattern)
                if len(amounts) >= 3:
                    cet1_requirement = amounts[2]
                    cet1_requirement_label = "CET1 capital ratio requirement (regulatory minimum)"
                    cet1_requirement_statement = "SEC 10-K standardized regulatory capital table"
                    break
            if cet1_requirement is not None:
                break

    if cet1_requirement is not None and 0 < cet1_requirement < 100:
        output.append({
            "concept": "BankMinimumCet1Ratio",
            "label": cet1_requirement_label,
            "value": cet1_requirement,
            "unit": "percent",
            "unit_scale": "percent",
            "period_end": report_date,
            "fiscal_year": report_year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": report_date,
            "primary_document": primary_document,
            "source_statement": cet1_requirement_statement,
        })

    # Regulatory capital rows must come from the reported risk-based metrics table,
    # not from the preceding capital-ratio requirements or subsidiary-only ratios.
    regulatory_facts_written: set[str] = set()
    for marker_index, marker_line in enumerate(lines):
        if not re.search(r"Risk-based capital metrics", marker_line, flags=re.IGNORECASE):
            continue
        table_lines = lines[marker_index:marker_index + 28]
        table_context = lines[max(0, marker_index - 8):marker_index + 28]
        table_text = " ".join(table_context).lower()
        header_text = " ".join(lines[max(0, marker_index - 8):marker_index])
        header_years = re.findall(r"(?:December|March|June|September)\s+\d{1,2},\s+((?:19|20)\d{2})", header_text, flags=re.IGNORECASE)
        if "standardized" not in table_text or not header_years or int(header_years[-1]) != report_year:
            continue
        for concept, label_pattern in (
            ("BankCET1Capital", r"(?:CET1|Common equity tier 1) capital\b(?!\s+ratio)"),
            ("BankRiskWeightedAssets", r"(?:Total )?Risk-weighted assets\b(?!\s+to\b)"),
        ):
            if concept in regulatory_facts_written:
                continue
            for relative_index, original_line in enumerate(table_lines):
                line = re.sub(r"\s+", " ", original_line).strip()
                if not re.match(label_pattern, line, flags=re.IGNORECASE):
                    continue
                value = _reported_amount_after_label(line, label_pattern)
                scale = _bank_unit_scale(lines, marker_index + relative_index, line)
                if value is None or scale is None:
                    continue
                output.append({
                    "concept": concept,
                    "label": re.match(label_pattern, line, flags=re.IGNORECASE).group(0).strip(),
                    "value": value,
                    "unit": "USD",
                    "unit_scale": scale,
                    "period_end": report_date,
                    "fiscal_year": report_year,
                    "fiscal_period": "FY",
                    "accession_number": accession_number,
                    "filing_date": filing_date,
                    "form": form,
                    "report_date": report_date,
                    "primary_document": primary_document,
                    "source_statement": "SEC 10-K standardized risk-based capital table",
                })
                regulatory_facts_written.add(concept)
                break

    return output


def _insurance_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []
    general_insurance_start = next((
        index for index, line in enumerate(lines)
        if re.fullmatch(r"\s*GENERAL INSURANCE\s*", line, flags=re.IGNORECASE)
        and any("Underwriting results:" in candidate for candidate in lines[index:index + 18])
    ), None)

    def append_fact(
        concept: str,
        label: str,
        value: float,
        *,
        year: int,
        unit: str,
        unit_scale: str,
        source_statement: str,
    ) -> None:
        period_end = f"{year}{report_date[4:]}"
        output.append({
            "concept": concept,
            "label": label,
            "value": value,
            "unit": unit,
            "unit_scale": unit_scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": source_statement,
        })

    if general_insurance_start is not None:
        general_insurance_lines = lines[general_insurance_start:general_insurance_start + 50]
        table_rows = (
            ("InsuranceNetPremiumsWritten", r"Net premiums written\b", "USD"),
            ("InsuranceNetPremiumsEarned", r"Net premiums earned\b", "USD"),
            ("InsuranceLossesAndLAE", r"Losses and loss adjustment expenses incurred\b", "USD"),
            ("InsuranceAcquisitionExpenses", r"Total acquisition expenses\b", "USD"),
            ("InsuranceGeneralOperatingExpenses", r"General operating expenses\b", "USD"),
            ("InsuranceUnderwritingIncome", r"Underwriting income\b", "USD"),
            ("InsuranceLossRatio", r"Loss ratio\b", "percent"),
            ("InsuranceExpenseRatio", r"Expense ratio\b", "percent"),
            ("InsuranceCombinedRatio", r"Combined ratio\b", "percent"),
            ("InsurancePriorYearReserveDevelopment", r"Prior year development, net of reinsurance and prior year premiums\b", "percent"),
        )
        for concept, label_pattern, unit_kind in table_rows:
            for relative_index, original_line in enumerate(general_insurance_lines):
                line = re.sub(r"\s+", " ", original_line).strip()
                if not re.match(label_pattern, line, flags=re.IGNORECASE):
                    continue
                amounts = _reported_amounts_after_label(line, label_pattern)
                if len(amounts) < 3:
                    continue
                unit_scale = "percent" if unit_kind == "percent" else _bank_unit_scale(lines, general_insurance_start + relative_index, line)
                if unit_scale is None:
                    continue
                label = re.match(label_pattern, line, flags=re.IGNORECASE).group(0).strip()
                for offset, amount in enumerate(amounts[:3]):
                    append_fact(
                        concept,
                        label,
                        amount,
                        year=report_year - offset,
                        unit=unit_kind,
                        unit_scale=unit_scale,
                        source_statement="SEC 10-K General Insurance underwriting table",
                    )
                break

    # The reported segment table includes three fiscal years in one row.
    net_investment_pattern = r"Net investment income for General Insurance were"
    for index, original_line in enumerate(lines):
        line = re.sub(r"\s+", " ", original_line).strip()
        match = re.search(net_investment_pattern, line, flags=re.IGNORECASE)
        if match is None:
            continue
        line_tail = line[match.start():]
        amounts = _reported_amounts_after_label(line_tail, net_investment_pattern)
        if len(amounts) < 3:
            continue
        unit_scale = _bank_unit_scale(lines, index, line_tail)
        if unit_scale is None:
            continue
        for offset, amount in enumerate(amounts[:3]):
            append_fact(
                "InsuranceNetInvestmentIncome",
                "General Insurance net investment income",
                amount,
                year=report_year - offset,
                unit="USD",
                unit_scale=unit_scale,
                source_statement="SEC 10-K General Insurance investment income reconciliation",
            )
        break

    for concept, marker_pattern, row_pattern, label in (
        (
            "InsuranceUnpaidLossReservesBeginning",
            r"The following table presents the rollforward of activity in loss reserves:",
            r"Net liability for unpaid loss and loss adjustment expenses, beginning of year\b",
            "Net unpaid loss reserves, beginning of year",
        ),
        (
            "InsuranceLossesIncurredForReserveRollforward",
            r"Losses and loss adjustment expenses incurred:",
            r"Total losses and loss adjustment expenses incurred\b",
            "Total losses and loss adjustment expenses incurred",
        ),
        (
            "InsuranceLossesPaidForReserveRollforward",
            r"Losses and loss adjustment expenses paid:",
            r"Total losses and loss adjustment expenses paid\b",
            "Total losses and loss adjustment expenses paid",
        ),
        (
            "InsuranceReserveOtherChanges",
            r"Other changes:",
            r"Total other changes\b",
            "Total other reserve changes",
        ),
        (
            "InsuranceUnpaidLossReserves",
            r"Liability for unpaid loss and loss adjustment expenses, end of year:",
            r"Net liability for unpaid losses and loss adjustment expenses\b",
            "Net liability for unpaid losses and loss adjustment expenses",
        ),
        (
            "InsuranceReinsuranceRecoverable",
            r"Liability for unpaid loss and loss adjustment expenses, end of year:",
            r"Reinsurance recoverable\b",
            "Reinsurance recoverable on unpaid losses and loss adjustment expenses",
        ),
        (
            "InsuranceGrossLossReserves",
            r"Liability for unpaid loss and loss adjustment expenses, end of year:",
            r"Total\b",
            "Gross liability for unpaid losses and loss adjustment expenses",
        ),
        (
            "InsuranceStatutoryCapitalSurplus",
            r"Statutory capital and surplus\s*\(a\)\(b\):",
            r"Total General Insurance companies\b",
            "General Insurance statutory capital and surplus",
        ),
        (
            "InsuranceMinimumStatutoryCapital",
            r"Aggregate minimum required statutory capital and surplus:",
            r"Total General Insurance companies\b",
            "Minimum required General Insurance statutory capital and surplus",
        ),
    ):
        start = next((index for index, line in enumerate(lines) if re.search(marker_pattern, line, flags=re.IGNORECASE)), None)
        if start is None:
            continue
        for index in range(start + 1, min(len(lines), start + 12)):
            line = re.sub(r"\s+", " ", lines[index]).strip()
            if not re.match(row_pattern, line, flags=re.IGNORECASE):
                continue
            amounts = _reported_amounts_after_label(line, row_pattern)
            unit_scale = _bank_unit_scale(lines, index, line)
            if not amounts or unit_scale is None:
                continue
            year_count = min(2, len(amounts)) if concept in {"InsuranceStatutoryCapitalSurplus", "InsuranceMinimumStatutoryCapital"} else min(3, len(amounts))
            for offset, amount in enumerate(amounts[:year_count]):
                append_fact(
                    concept,
                    label,
                    amount,
                    year=report_year - offset,
                    unit="USD",
                    unit_scale=unit_scale,
                    source_statement="SEC 10-K insurance reserve/capital table",
                )
            break

    # AIG presents parent and Corebridge-related activity in a separate Other Operations table.
    for marker_index, marker_line in enumerate(lines):
        if not re.fullmatch(r"\s*OTHER OPERATIONS\s*", marker_line, flags=re.IGNORECASE):
            continue
        section = lines[marker_index:marker_index + 24]
        if not any("Years Ended December 31" in line for line in section):
            continue
        for relative_index, original_line in enumerate(section):
            line = re.sub(r"\s+", " ", original_line).strip()
            if not re.match(r"Adjusted pre-tax loss\*?\b", line, flags=re.IGNORECASE):
                continue
            amounts = _reported_amounts_after_label(line, r"Adjusted pre-tax loss\*?\b")
            unit_scale = _bank_unit_scale(lines, marker_index + relative_index, line)
            if len(amounts) < 3 or unit_scale is None:
                continue
            for offset, amount in enumerate(amounts[:3]):
                append_fact(
                    "InsuranceOtherOperationsPretaxIncome",
                    "Other Operations adjusted pre-tax income (loss)",
                    amount,
                    year=report_year - offset,
                    unit="USD",
                    unit_scale=unit_scale,
                    source_statement="SEC 10-K Other Operations segment table",
                )
            break
        break

    return output


def _life_insurance_filing_facts_from_html(
    filing_html: str,
    *,
    ticker: str,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    """Extract issuer-defined earnings and statutory-capital disclosures from life-insurer 10-K HTML.

    Dispatch is filing-marker driven: each schedule block is attempted and
    no-ops when its markers are absent, so any life insurer whose filing
    carries the same schedule shape resolves facts. `ticker` is retained
    only for log context.
    """
    normalized_ticker = (ticker or "").strip().upper()
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    soup = BeautifulSoup(filing_html, "lxml")
    tables = soup.find_all("table")
    output: list[Dict[str, Any]] = []
    source_metadata = {
        "accession_number": accession_number,
        "filing_date": filing_date,
        "form": form,
        "report_date": report_date,
        "primary_document": primary_document,
    }

    def append_fact(
        metric: str,
        value: float,
        *,
        year: int,
        source_statement: str,
        segment: str | None = None,
        capital_group: str | None = None,
        unit: str = "USD",
        unit_scale: str = "millions",
        earnings_basis: str = "not_applicable",
        comparison_operator: str | None = None,
    ) -> None:
        output.append({
            "metric": metric,
            "segment": segment,
            "capital_group": capital_group,
            "value": value,
            "unit": unit,
            "unit_scale": unit_scale,
            "fiscal_year": year,
            "fiscal_period": f"FY{year}",
            **source_metadata,
            "source_statement": source_statement,
            "earnings_basis": earnings_basis,
            "comparison_operator": comparison_operator,
        })

    def row_texts(table) -> list[str]:
        return [
            " ".join(cell.get_text(" ", strip=True) for cell in row.find_all(["td", "th"]))
            for row in table.find_all("tr")
        ]

    def parse_segment_table(
        *,
        required_markers: tuple[str, ...],
        segments: tuple[str, ...],
        metric: str,
        earnings_basis: str,
        source_label: str,
    ) -> None:
        candidate = None
        candidate_text = ""
        for table in tables:
            text = re.sub(r"\s+", " ", table.get_text(" ", strip=True))
            if not all(marker.lower() in text.lower() for marker in required_markers):
                continue
            if not all(str(year) in text for year in (report_year, report_year - 1, report_year - 2)):
                continue
            if sum(1 for segment in segments if re.search(rf"\b{re.escape(segment)}\b", text, re.IGNORECASE)) < len(segments):
                continue
            candidate, candidate_text = table, text
            break
        if candidate is None:
            return
        for segment in segments:
            pattern = rf"^{re.escape(segment)}\b"
            row = next((line for line in row_texts(candidate) if re.match(pattern, re.sub(r"\s+", " ", line).strip(), re.IGNORECASE)), None)
            amounts = _reported_amounts_after_label(row, pattern) if row else []
            if len(amounts) < 3:
                logger.warning("Life-insurance earnings row unavailable for %s / %s", normalized_ticker, segment)
                continue
            for offset, amount in enumerate(amounts[:3]):
                year = report_year - offset
                append_fact(
                    metric,
                    amount,
                    year=year,
                    segment=segment,
                    source_statement=f"SEC {form} MD&A, {source_label}; {segment}; FY{year}; {candidate_text[:1800]}",
                    earnings_basis=earnings_basis,
                )

    met_markers_present = ("adjusted earnings available to common" in soup.get_text(" ", strip=True).lower())
    pru_markers_present = ("adjusted operating income before income taxes" in soup.get_text(" ", strip=True).lower())
    if met_markers_present:
        parse_segment_table(
            required_markers=("Adjusted earnings available to common shareholders on a constant currency basis", "Group Benefits"),
            segments=("Group Benefits", "RIS", "Asia", "Latin America", "EMEA", "MIM", "Corporate & Other"),
            metric="adjusted_earnings_available_to_common",
            earnings_basis="after_tax_adjusted_earnings_available_to_common",
            source_label="adjusted earnings available to common shareholders by segment",
        )
        flat_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
        for pattern, metric, capital_group in (
            (r"Statement-Based Combined RBC Ratio was in excess of\s*(\d{3})% and in excess of\s*(\d{3})% at December 31,\s*(20\d{2}) and\s*(20\d{2})", "statement_based_combined_rbc_ratio_floor", "U.S. principal insurance subsidiaries; statement-based company measure"),
            (r"NAIC-Based Combined RBC Ratio was in excess of\s*(\d{3})% and in excess of\s*(\d{3})% at December 31,\s*(20\d{2}) and\s*(20\d{2})", "naic_based_combined_rbc_ratio_floor", "U.S. principal insurance subsidiaries; NAIC-based"),
        ):
            match = re.search(pattern, flat_text, re.IGNORECASE)
            if not match:
                continue
            source_start = max(0, match.start() - 220)
            source_statement = flat_text[source_start:match.end() + 80]
            for offset in (0, 1):
                append_fact(
                    metric,
                    float(match.group(1 + offset)) / 100.0,
                    year=int(match.group(3 + offset)),
                    capital_group=capital_group,
                    unit="ratio",
                    unit_scale="ratio",
                    source_statement=source_statement,
                    comparison_operator="greater_than",
                )

        dividend_table = next((table for table in tables if all(
            marker.lower() in re.sub(r"\s+", " ", table.get_text(" ", strip=True)).lower()
            for marker in ("Permitted Without Approval", "2026", "2025", "2024", "Metropolitan Life Insurance Company")
        )), None)
        if dividend_table is not None:
            for capital_group in ("Metropolitan Life Insurance Company", "American Life Insurance Company", "Metropolitan Tower Life Insurance Company"):
                pattern = rf"^{re.escape(capital_group)}\b"
                row = next((line for line in row_texts(dividend_table) if re.match(pattern, re.sub(r"\s+", " ", line).strip(), re.IGNORECASE)), None)
                amounts = _reported_amounts_after_label(row, pattern) if row else []
                if len(amounts) < 5:
                    continue
                for metric, year, amount, column_label in (
                    ("permitted_ordinary_dividend_without_approval", 2026, amounts[0], "2026 permitted without approval"),
                    ("paid_upstream_dividend", 2025, amounts[1], "2025 paid"),
                    ("permitted_ordinary_dividend_without_approval", 2025, amounts[2], "2025 permitted without approval"),
                    ("paid_upstream_dividend", 2024, amounts[3], "2024 paid"),
                    ("permitted_ordinary_dividend_without_approval", 2024, amounts[4], "2024 permitted without approval"),
                ):
                    append_fact(
                        metric,
                        amount,
                        year=year,
                        capital_group=capital_group,
                        source_statement=f"SEC {form} MD&A, {column_label}; source row: {row}",
                    )
    if pru_markers_present:
        parse_segment_table(
            required_markers=("Adjusted operating income before income taxes by segment", "PGIM"),
            segments=("PGIM", "Retirement Strategies", "Group Insurance", "Individual Life", "International Businesses", "Corporate and Other"),
            metric="adjusted_operating_income_pretax",
            earnings_basis="pre_tax_adjusted_operating_income",
            source_label="adjusted operating income before income taxes by segment",
        )
        pica_table = next((table for table in tables if all(
            marker.lower() in re.sub(r"\s+", " ", table.get_text(" ", strip=True)).lower()
            for marker in ("PICA", "Statutory capital and surplus", "Statutory net income", "December 31, 2025", "December 31, 2024", "December 31, 2023")
        )), None)
        if pica_table is not None:
            for metric, label in (
                ("statutory_net_income", "Statutory net income (loss)"),
                ("statutory_capital_and_surplus", "Statutory capital and surplus"),
            ):
                pattern = rf"^{re.escape(label)}(?:\(\d+\))?"
                row = next((line for line in row_texts(pica_table) if re.match(pattern, re.sub(r"\s+", " ", line).strip(), re.IGNORECASE)), None)
                amounts = _reported_amounts_after_label(row, pattern) if row else []
                for offset, amount in enumerate(amounts[:3]):
                    append_fact(
                        metric,
                        amount,
                        year=report_year - offset,
                        capital_group="PICA",
                        source_statement=f"SEC {form} statutory financial information, PICA; {label}; FY{report_year - offset}; {row}",
                    )

        flat_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
        rbc_statement = re.search(r"RBC ratios for PICA and its other domestic insurance subsidiaries as of December 31,\s*(20\d{2}) above the\s*(\d{3})% regulatory required minimum[^.]*", flat_text, re.IGNORECASE)
        if rbc_statement:
            append_fact(
                "rbc_minimum_regulatory_threshold_floor",
                float(rbc_statement.group(2)) / 100.0,
                year=int(rbc_statement.group(1)),
                capital_group="PICA and other domestic insurance subsidiaries; regulatory action threshold",
                unit="ratio",
                unit_scale="ratio",
                source_statement=rbc_statement.group(0),
                comparison_operator="greater_than",
            )

        dividend_statement = re.search(r"PICA is permitted to pay an ordinary dividend of up to\s*\$\s*([\d,]+)\s+million in\s*(20\d{2})", flat_text, re.IGNORECASE)
        if dividend_statement:
            append_fact(
                "permitted_ordinary_dividend_without_approval",
                float(dividend_statement.group(1).replace(",", "")),
                year=int(dividend_statement.group(2)),
                capital_group="PICA; New Jersey ordinary-dividend limit",
                source_statement=dividend_statement.group(0),
            )

    unique: dict[tuple[str, str, int, str], Dict[str, Any]] = {}
    for fact in output:
        identity = (fact["metric"], fact.get("segment") or "", fact["fiscal_year"], fact.get("capital_group") or "")
        unique.setdefault(identity, fact)
    return list(unique.values())


def _reit_reported_amounts_after_label(line: str, label_pattern: str) -> list[float]:
    normalized_line = re.sub(r"\s+", " ", line).strip()
    match = re.match(label_pattern, normalized_line, flags=re.IGNORECASE)
    if match is None:
        return []
    tokens = re.findall(
        r"(?<![A-Za-z0-9.])(?:\(?-?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?|[–—-])(?![A-Za-z0-9.])",
        normalized_line[match.end():],
    )
    values: list[float] = []
    for token in tokens:
        if token in {"-", "–", "—"}:
            values.append(0.0)
            continue
        raw = token.replace("$", "").replace(" ", "").replace(",", "")
        negative = raw.startswith("(") or raw.startswith("-")
        try:
            amount = float(raw.strip("()"))
        except ValueError:
            continue
        values.append(-amount if negative else amount)
    return values


def _reit_unit_scale(lines: list[str], line_index: int, line: str) -> str | None:
    if re.search(r"\bin\s+billions\b", line, flags=re.IGNORECASE):
        return "billions"
    for previous_line in reversed(lines[max(0, line_index - 100):line_index + 1]):
        if re.search(r"\bin\s+billions\b", previous_line, flags=re.IGNORECASE):
            return "billions"
        if re.search(r"\bin\s+millions\b", previous_line, flags=re.IGNORECASE):
            return "millions"
        if re.search(r"\bin\s+thousands\b", previous_line, flags=re.IGNORECASE):
            return "thousands"
    return None


def _reit_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []

    def append_fact(concept: str, label: str, value: float, *, year: int, unit: str, unit_scale: str, source_statement: str) -> None:
        period_end = f"{year}{report_date[4:]}"
        output.append({
            "concept": concept,
            "label": label,
            "value": value,
            "unit": unit,
            "unit_scale": unit_scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": source_statement,
        })

    ffo_start = next((index for index, line in enumerate(lines) if re.search(
        r"Reconciliation of net earnings attributable to common stockholders to FFO measures", line, flags=re.IGNORECASE,
    )), None)
    if ffo_start is not None:
        ffo_table = lines[ffo_start:min(len(lines), ffo_start + 45)]

        def find_ffo_row(pattern: str, start: int, end: int) -> int | None:
            return next((index for index in range(start, min(end, len(ffo_table))) if re.match(
                pattern, re.sub(r"\s+", " ", ffo_table[index]).strip(), flags=re.IGNORECASE,
            )), None)

        def append_ffo_row(concept: str, pattern: str, label: str, start: int, end: int) -> int | None:
            row_index = find_ffo_row(pattern, start, end)
            if row_index is None:
                return None
            row = re.sub(r"\s+", " ", ffo_table[row_index]).strip()
            amounts = _reit_reported_amounts_after_label(row, pattern)
            unit_scale = _reit_unit_scale(lines, ffo_start + row_index, row)
            if len(amounts) < 2 or unit_scale is None:
                return None
            for offset, amount in enumerate(amounts[:2]):
                append_fact(concept, label, amount, year=report_year - offset, unit="USD", unit_scale=unit_scale, source_statement="SEC 10-K NAREIT, modified FFO, and Core FFO reconciliation")
            return row_index

        nareit_total = find_ffo_row(r"NAREIT defined FFO attributable to common stockholders/unitholders\b", 0, len(ffo_table))
        modified_section = next((index for index, row in enumerate(ffo_table) if re.search(r"Add \(deduct\) our modified adjustments", row, flags=re.IGNORECASE)), None)
        modified_total = find_ffo_row(r"FFO, as modified by Prologis attributable to common stockholders/unitholders\b", 0, len(ffo_table))
        core_section = next((index for index, row in enumerate(ffo_table) if re.search(r"Adjustments to arrive at Core FFO", row, flags=re.IGNORECASE)), None)
        core_total = find_ffo_row(r"Core FFO attributable to common stockholders/unitholders\b", 0, len(ffo_table))
        if nareit_total is None or modified_section is None or modified_total is None or core_section is None or core_total is None:
            nareit_total = modified_section = modified_total = core_section = core_total = len(ffo_table)

        append_ffo_row("ReitNareitBridgeNetIncome", r"Net earnings attributable to common stockholders\b", "Net earnings attributable to common stockholders", 0, nareit_total)
        append_ffo_row("ReitRealEstateDepreciation", r"Real estate related depreciation and amortization\b", "Real estate related depreciation and amortization", 0, nareit_total)
        append_ffo_row("ReitDispositionGainsNareitAdjustment", r"Gains on other dispositions of investments in real estate, net of taxes \(excluding development\b", "NAREIT FFO disposition gain adjustment, net of tax", 0, nareit_total)
        append_ffo_row("ReitNciNareitAdjustment", r"Adjustments related to noncontrolling interests\b", "NAREIT FFO noncontrolling-interest adjustment", 0, nareit_total)
        append_ffo_row("ReitUnconsolidatedNareitAdjustment", r"Our proportionate share of adjustments related to unconsolidated entities\b", "NAREIT FFO proportionate share of unconsolidated adjustments", 0, nareit_total)
        append_ffo_row("ReitNareitFFO", r"NAREIT defined FFO attributable to common stockholders/unitholders\b", "NAREIT defined FFO attributable to common stockholders/unitholders", nareit_total, nareit_total + 1)

        append_ffo_row("ReitModifiedFfoFxAdjustment", r"Unrealized foreign currency, derivative and other losses \(gains\), net\b", "Modified FFO foreign-currency, derivative, and other adjustment", modified_section, modified_total)
        append_ffo_row("ReitModifiedFfoDeferredTaxAdjustment", r"Deferred income tax expense \(benefit\)", "Modified FFO deferred-tax adjustment", modified_section, modified_total)
        append_ffo_row("ReitModifiedFfoCurrentTaxAdjustment", r"Current income tax benefit on dispositions related to acquired tax liabilities\b", "Modified FFO current-tax benefit on acquired tax liabilities", modified_section, modified_total)
        append_ffo_row("ReitModifiedFfoNciAdjustment", r"Reconciling items related to noncontrolling interests\b", "Modified FFO noncontrolling-interest adjustment", modified_section, modified_total)
        append_ffo_row("ReitModifiedFfoUnconsolidatedAdjustment", r"Our proportionate share of adjustments related to unconsolidated entities\b", "Modified FFO proportionate share of unconsolidated adjustments", modified_section, modified_total)
        append_ffo_row("ReitModifiedFFO", r"FFO, as modified by Prologis attributable to common stockholders/unitholders\b", "FFO, as modified by Prologis attributable to common stockholders/unitholders", modified_total, modified_total + 1)

        append_ffo_row("ReitCoreFfoDispositionAdjustment", r"Gains on dispositions of development properties and land, net\b", "Core FFO development-property and land disposition adjustment", core_section, core_total)
        append_ffo_row("ReitCoreFfoTaxAdjustment", r"Current income tax expense(?: \(benefit\))? on dispositions\b", "Core FFO current-tax adjustment on dispositions", core_section, core_total)
        append_ffo_row("ReitCoreFfoDebtExtinguishmentAdjustment", r"Losses \(gains\) on early extinguishment of debt, net\b", "Core FFO debt-extinguishment adjustment", core_section, core_total)
        append_ffo_row("ReitCoreFfoNciAdjustment", r"Adjustments related to noncontrolling interests\b", "Core FFO noncontrolling-interest adjustment", core_section, core_total)
        append_ffo_row("ReitCoreFfoUnconsolidatedAdjustment", r"Our proportionate share of adjustments related to unconsolidated entities\b", "Core FFO proportionate share of unconsolidated adjustments", core_section, core_total)
        append_ffo_row("ReitCoreFFO", r"Core FFO attributable to common stockholders/unitholders\b", "Core FFO attributable to common stockholders/unitholders", core_total, core_total + 1)

    cashflow_start = next((index for index, line in enumerate(lines) if re.match(r"Operating activities:", line.strip(), flags=re.IGNORECASE)), None)
    if cashflow_start is not None:
        cashflow_end = next((index for index in range(cashflow_start + 1, min(cashflow_start + 85, len(lines))) if re.match(r"Financing activities:", lines[index].strip(), flags=re.IGNORECASE)), min(len(lines), cashflow_start + 85))
        cashflow_specs = (
            ("ReitTenantImprovementsAndLeaseCommissions", r"Tenant improvements and lease commissions on previously leased space\b", "Tenant improvements and lease commissions on previously leased space", True),
            ("ReitPropertyImprovements", r"Property improvements\b", "Property improvements", True),
            ("ReitCommonDistributions", r"Dividends paid on common and preferred stock\b", "Dividends paid on common and preferred stock", True),
        )
        for concept, label_pattern, label, use_abs in cashflow_specs:
            row_index = next((index for index in range(cashflow_start, cashflow_end) if re.match(label_pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)), None)
            if row_index is None:
                continue
            amounts_line = re.sub(r"\s+", " ", lines[row_index]).strip()
            amounts = _reit_reported_amounts_after_label(amounts_line, label_pattern)
            unit_scale = _reit_unit_scale(lines, row_index, amounts_line)
            if len(amounts) < 3 or unit_scale is None:
                continue
            for offset, raw_amount in enumerate(amounts[:3]):
                amount = abs(raw_amount) if use_abs else raw_amount
                append_fact(concept, label, amount, year=report_year - offset, unit="USD", unit_scale=unit_scale, source_statement="SEC 10-K consolidated cash flow statement")

    financing_start = next((index for index, line in enumerate(lines) if re.match(r"Financing activities:", line.strip(), flags=re.IGNORECASE)), None)
    if financing_start is not None:
        distribution_pattern = r"Dividends paid on common and preferred stock\b"
        distribution_index = next((index for index in range(financing_start, min(financing_start + 55, len(lines))) if re.match(
            distribution_pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE,
        )), None)
        if distribution_index is not None:
            line = re.sub(r"\s+", " ", lines[distribution_index]).strip()
            amounts = _reit_reported_amounts_after_label(line, distribution_pattern)
            unit_scale = _reit_unit_scale(lines, distribution_index, line)
            if len(amounts) >= 3 and unit_scale is not None:
                for offset, amount in enumerate(amounts[:3]):
                    append_fact("ReitCommonDistributions", "Dividends paid on common and preferred stock", abs(amount), year=report_year - offset, unit="USD", unit_scale=unit_scale, source_statement="SEC 10-K consolidated cash flow statement")

    for concept, label_pattern, label in (
        ("ReitSameStoreNOINetEffective", r"Prologis Share of Same Store Property NOI\s*[–-]\s*Net Effective\b", "Prologis Share of Same Store Property NOI — Net Effective"),
        ("ReitSameStoreNOICash", r"Prologis Share of Same Store Property NOI\s*[–-]\s*Cash\b", "Prologis Share of Same Store Property NOI — Cash"),
    ):
        for row_index, original_line in enumerate(lines):
            line = re.sub(r"\(\d+\)", "", re.sub(r"\s+", " ", original_line)).strip()
            if not re.match(label_pattern, line, flags=re.IGNORECASE):
                continue
            amounts = _reit_reported_amounts_after_label(line, label_pattern)
            unit_scale = _reit_unit_scale(lines, row_index, line)
            if len(amounts) < 2 or unit_scale is None:
                continue
            for offset, amount in enumerate(amounts[:2]):
                append_fact(concept, label, amount, year=report_year - offset, unit="USD", unit_scale=unit_scale, source_statement="SEC 10-K same-store property NOI reconciliation")
            break

    segment_start = next((index for index, line in enumerate(lines) if re.search(r"Segment net operating income:", line, flags=re.IGNORECASE)), None)
    if segment_start is not None:
        for concept, label_pattern, label in (
            ("ReitRealEstateSegmentNOI", r"Total real estate segment\b", "Total real estate segment net operating income"),
            ("ReitStrategicCapitalSegmentNOI", r"Total strategic capital segment\b", "Total strategic capital segment net operating income"),
        ):
            row_index = next((index for index in range(segment_start, min(segment_start + 24, len(lines))) if re.match(label_pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE)), None)
            if row_index is None:
                continue
            amounts_line = re.sub(r"\s+", " ", lines[row_index]).strip()
            amounts = _reit_reported_amounts_after_label(amounts_line, label_pattern)
            unit_scale = _reit_unit_scale(lines, row_index, amounts_line)
            if len(amounts) < 3 or unit_scale is None:
                continue
            for offset, amount in enumerate(amounts[:3]):
                append_fact(concept, label, amount, year=report_year - offset, unit="USD", unit_scale=unit_scale, source_statement="SEC 10-K reportable segment NOI table")

    for row_index, original_line in enumerate(lines):
        line = re.sub(r"\s+", " ", original_line).strip()
        match = re.search(r"occupancy in our operating portfolio of\s+(\d+(?:\.\d+)?)%", line, flags=re.IGNORECASE)
        if match:
            append_fact("ReitOccupancy", "Reported operating portfolio occupancy", float(match.group(1)), year=report_year, unit="percent", unit_scale="percent", source_statement="SEC 10-K operating portfolio overview")
            break

    return output


def _issuer_debt_cost_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    lines = filing_text.splitlines()
    anchor_pattern = re.compile(rf"^\s*{report_year}\s+debt issuance\s*:", flags=re.IGNORECASE)
    anchor = next((index for index, line in enumerate(lines) if anchor_pattern.match(line)), None)
    if anchor is None:
        return []
    candidate_indices = list(range(anchor - 1, max(anchor - 7, -1), -1)) + list(range(anchor + 1, min(anchor + 30, len(lines))))
    for index in candidate_indices:
        line = re.sub(r"\s+", " ", lines[index]).strip()
        if not re.match(r"Fixed-rate\b", line, flags=re.IGNORECASE):
            continue
        rates = [float(value) for value in re.findall(r"(?<![\d.])(\d+(?:\.\d+)?)\s*%", line)]
        if len(rates) < 4:
            continue
        # The final rate range is labeled as the tranche's effective interest-rate range.
        effective_low, effective_high = rates[-2:]
        midpoint = (effective_low + effective_high) / 2.0
        if not 0 < midpoint < 20:
            continue
        return [{
            "concept": "IssuerRecentDebtIssueEffectiveRateRangeMidpoint",
            "label": f"FY{report_year} new debt effective-rate range {effective_low:.2f}%–{effective_high:.2f}%",
            "value": midpoint,
            "unit": "percent",
            "unit_scale": "percent",
            "period_end": report_date,
            "fiscal_year": report_year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": report_date,
            "primary_document": primary_document,
            "source_statement": "SEC 10-K new debt issuance table; analyst midpoint of the filed effective-rate range",
        }]
    return []


async def _fetch_issuer_debt_cost_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    annual_filings = [filing for filing in source_filings if filing.get("form") == "10-K"]
    if not annual_filings:
        return []
    filing_record = max(annual_filings, key=lambda item: str(item.get("filing_date") or ""))
    try:
        filings = await asyncio.to_thread(company.get_filings, form="10-K")
        filing = await asyncio.to_thread(filings.get, str(filing_record["accession_number"]))
        filing_text = await asyncio.to_thread(_resilient_filing_text, filing)
    except Exception as exc:
        logger.info("Issuer debt-rate disclosure unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
        return []
    return _issuer_debt_cost_facts_from_text(
        filing_text,
        report_date=str(filing_record.get("report_date") or ""),
        filing_date=str(filing_record.get("filing_date") or ""),
        accession_number=str(filing_record.get("accession_number") or ""),
        form=str(filing_record.get("form") or "10-K"),
        primary_document=filing_record.get("primary_document"),
    )


async def _fetch_financial_institution_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
    ticker: str,
) -> tuple[list[Dict[str, Any]], list[Dict[str, Any]], list[Dict[str, Any]]]:
    annual_filings = [
        filing for filing in source_filings
        if filing.get("form") in {"10-K", "10-K/A"}
    ]
    if not annual_filings:
        return [], [], []
    filing_record = max(annual_filings, key=lambda item: str(item.get("filing_date") or ""))
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
        filing = await asyncio.to_thread(filings.get, str(filing_record["accession_number"]))
        filing_text = await asyncio.to_thread(_resilient_filing_text, filing)
    except Exception as exc:
        logger.warning("Financial institution filing-table extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
        return [], [], []
    source_metadata = {
        "report_date": str(filing_record.get("report_date") or ""),
        "filing_date": str(filing_record.get("filing_date") or ""),
        "accession_number": str(filing_record.get("accession_number") or ""),
        "form": str(filing_record.get("form") or "10-K"),
        "primary_document": filing_record.get("primary_document"),
    }
    bank_facts = _bank_filing_facts_from_text(
        filing_text,
        **source_metadata,
    )
    insurance_facts = _insurance_filing_facts_from_text(
        filing_text,
        **source_metadata,
    )
    life_insurance_facts: list[Dict[str, Any]] = []
    try:
        filing_html = await asyncio.to_thread(_resilient_filing_html, filing)
        life_insurance_facts = _life_insurance_filing_facts_from_html(
            filing_html,
            ticker=ticker,
            **source_metadata,
        )
    except Exception as exc:
        logger.warning("Life-insurance filing extraction unavailable for %s (%s)", ticker, type(exc).__name__)
    return bank_facts, insurance_facts, life_insurance_facts


def _telecom_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    """Parse AT&T's comparative segment and subscriber tables from its 10-K."""
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []

    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []

    def append_fact(
        concept: str,
        label: str,
        value: float,
        year: int,
        unit: str,
        scale: str,
        table: str,
        source_components: list[Dict[str, Any]] | None = None,
    ) -> None:
        period_end = f"{year}{report_date[4:]}"
        fact = {
            "concept": concept,
            "label": label,
            "value": value,
            "unit": unit,
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": table,
        }
        if source_components is not None:
            fact["source_components"] = source_components
        output.append(fact)

    def source_component(concept: str, label: str, value: float, year: int, scale: str, table: str) -> Dict[str, Any]:
        period_end = f"{year}{report_date[4:]}"
        return {
            "concept": concept,
            "label": label,
            "value": value,
            "unit": "USD",
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": table,
        }

    def find_line(pattern: str, start: int = 0, end: int | None = None) -> int | None:
        stop = len(lines) if end is None else min(end, len(lines))
        for index in range(start, stop):
            if re.match(pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE):
                return index
        return None

    def series(
        concept: str,
        label: str,
        row_pattern: str,
        start: int,
        end: int,
        *,
        unit: str,
        scale: str,
        table: str,
        max_values: int = 3,
    ) -> None:
        index = find_line(row_pattern, start, end)
        if index is None:
            return
        values = _reported_amounts_after_label(lines[index], row_pattern)
        for offset, value in enumerate(values[:max_values]):
            append_fact(concept, label, value, report_year - offset, unit, scale, table)

    # The first comparative segment table reconciles Communications revenue and EBIT.
    segment_revenue_start = find_line(r"Segment Operating Revenues\s*$")
    if segment_revenue_start is not None:
        segment_revenue_end = min(segment_revenue_start + 18, len(lines))
        for concept, label, row in (
            ("TelecomMobilityRevenue", "Mobility segment revenue", r"Mobility\s+\$?"),
            ("TelecomBusinessWirelineRevenue", "Business Wireline segment revenue", r"Business Wireline\s+\$?"),
            ("TelecomConsumerWirelineRevenue", "Consumer Wireline segment revenue", r"Consumer Wireline\s+\$?"),
            ("TelecomCommunicationsRevenue", "Communications segment revenue", r"Total Segment Operating Revenues\s+\$?"),
        ):
            series(concept, label, row, segment_revenue_start + 1, segment_revenue_end,
                   unit="USD", scale="millions", table="SEC 10-K Communications segment revenue table")

    segment_income_start = find_line(r"Segment Operating Income(?: \(Loss\))?\s*$", segment_revenue_start or 0)
    if segment_income_start is not None:
        segment_income_end = min(segment_income_start + 18, len(lines))
        for concept, label, row in (
            ("TelecomMobilityOperatingIncome", "Mobility segment operating income", r"Mobility\s+\$?"),
            ("TelecomBusinessWirelineOperatingIncome", "Business Wireline segment operating income", r"Business Wireline\s+\$?"),
            ("TelecomCommunicationsOperatingIncome", "Communications segment operating income", r"Total Segment Operating Income\s+\$?"),
        ):
            series(concept, label, row, segment_income_start + 1, segment_income_end,
                   unit="USD", scale="millions", table="SEC 10-K Communications segment operating income table")

    mobility_start = find_line(r"Mobility Results\s*$")
    business_wireline_start = find_line(r"Business Wireline Results\s*$", (mobility_start or 0) + 1)
    if mobility_start is not None:
        mobility_end = business_wireline_start or min(mobility_start + 120, len(lines))
        for concept, label, row in (
            ("TelecomMobilityServiceRevenue", "Mobility service revenue", r"Service\s+\$?"),
            ("TelecomMobilityEquipmentRevenue", "Mobility equipment revenue", r"Equipment\s+\$?"),
            ("TelecomMobilityReportedRevenue", "Mobility total operating revenue", r"Total Operating Revenues\s+\$?"),
            ("TelecomMobilityOperatingExpenses", "Mobility operating expenses", r"Total Operating Expenses\s+\$?"),
            ("TelecomMobilityDepreciation", "Mobility depreciation and amortization", r"Depreciation and amortization\s+\$?"),
            ("TelecomMobilityOperatingIncome", "Mobility operating income", r"Operating Income\s+\$?"),
        ):
            series(concept, label, row, mobility_start + 1, mobility_end,
                   unit="USD", scale="millions", table="SEC 10-K Mobility results table")

        subscriber_start = find_line(r"The following tables highlight other key measures of performance for Mobility:", mobility_start, mobility_end)
        if subscriber_start is not None:
            subscriber_end = find_line(r"AT&T Inc\.", subscriber_start + 1, mobility_end) or mobility_end
            for concept, label, row in (
                ("TelecomPostpaidSubscribers", "Postpaid wireless subscribers", r"Postpaid\s+(?=\d)"),
                ("TelecomPostpaidPhoneSubscribers", "Postpaid phone subscribers", r"Postpaid phone\s+(?=\d)"),
                ("TelecomPrepaidSubscribers", "Prepaid wireless subscribers", r"Prepaid\s+(?=\d)"),
                ("TelecomResellerSubscribers", "Reseller wireless subscribers", r"Reseller\s+(?=\d)"),
                ("TelecomWirelessSubscribers", "Total Mobility subscribers", r"Total Mobility Subscribers\s+1\s+"),
                ("TelecomPostpaidPhoneNetAdditions", "Postpaid phone net additions", r"Postpaid Phone Net Additions\s+"),
                ("TelecomWirelessNetAdditions", "Mobility net subscriber additions", r"Mobility Net Subscriber Additions\s+2,3\s+"),
                ("TelecomPostpaidChurn", "Postpaid monthly churn", r"Postpaid Churn\s+4\s+"),
                ("TelecomPostpaidPhoneChurn", "Postpaid phone monthly churn", r"Postpaid Phone Churn\s+4\s+"),
            ):
                unit = "percent" if "Churn" in concept else "subscribers"
                scale = "monthly" if "Churn" in concept else "thousands"
                series(concept, label, row, subscriber_start + 1, subscriber_end,
                       unit=unit, scale=scale, table="SEC 10-K Mobility subscriber and churn table")

    if business_wireline_start is not None:
        consumer_wireline_start = find_line(r"Consumer Wireline Results\s*$", business_wireline_start + 1)
        business_wireline_end = consumer_wireline_start or min(business_wireline_start + 90, len(lines))
        for concept, label, row in (
            ("TelecomBusinessWirelineLegacyRevenue", "Business Wireline legacy and transitional revenue", r"Legacy and other transitional services\s+\$?"),
            ("TelecomBusinessWirelineFiberRevenue", "Business Wireline fiber and advanced connectivity revenue", r"Fiber and advanced connectivity\s+\$?"),
            ("TelecomBusinessWirelineEquipmentRevenue", "Business Wireline equipment revenue", r"Equipment\s+\$?"),
            ("TelecomBusinessWirelineOperatingExpenses", "Business Wireline operating expenses", r"Total Operating Expenses\s+\$?"),
            ("TelecomBusinessWirelineDepreciation", "Business Wireline depreciation and amortization", r"Depreciation and amortization\s+\$?"),
            ("TelecomBusinessWirelineReportedOperatingIncome", "Business Wireline operating income", r"Operating Income(?: \(Loss\))?\s+\$?"),
        ):
            series(concept, label, row, business_wireline_start + 1, business_wireline_end,
                   unit="USD", scale="millions", table="SEC 10-K Business Wireline results table")
    else:
        consumer_wireline_start = None

    if consumer_wireline_start is not None:
        consumer_wireline_end = min(consumer_wireline_start + 100, len(lines))
        for concept, label, row in (
            ("TelecomConsumerWirelineBroadbandRevenue", "Consumer Wireline broadband revenue", r"Broadband\s+\$?"),
            ("TelecomConsumerWirelineLegacyRevenue", "Consumer Wireline legacy voice and data revenue", r"Legacy voice and data services\s+\$?"),
            ("TelecomConsumerWirelineOtherRevenue", "Consumer Wireline other service and equipment revenue", r"Other service and equipment\s+\$?"),
            ("TelecomConsumerWirelineOperatingExpenses", "Consumer Wireline operating expenses", r"Total Operating Expenses\s+\$?"),
            ("TelecomConsumerWirelineDepreciation", "Consumer Wireline depreciation and amortization", r"Depreciation and amortization\s+\$?"),
            ("TelecomConsumerWirelineOperatingIncome", "Consumer Wireline operating income", r"Operating Income\s+\$?"),
        ):
            series(concept, label, row, consumer_wireline_start + 1, consumer_wireline_end,
                   unit="USD", scale="millions", table="SEC 10-K Consumer Wireline results table")

        broadband_start = find_line(r"Broadband Connections\s*$", consumer_wireline_start, consumer_wireline_end)
        if broadband_start is not None:
            broadband_end = find_line(r"AT&T Inc\.", broadband_start + 1, consumer_wireline_end) or consumer_wireline_end
            for concept, label, row in (
                ("TelecomBroadbandConnections", "Consumer Wireline broadband connections", r"Broadband\s+1\s+"),
                ("TelecomFiberBroadbandConnections", "Fiber broadband connections", r"Fiber Broadband Connections\s+(?=\d)"),
                ("TelecomBroadbandNetAdditions", "Broadband net additions", r"Broadband Net Additions\s+1,2\s+"),
                ("TelecomFiberBroadbandNetAdditions", "Fiber broadband net additions", r"Fiber Broadband Net Additions\s+(?=\d)"),
            ):
                series(concept, label, row, broadband_start + 1, broadband_end,
                       unit="subscribers", scale="thousands", table="SEC 10-K Consumer Wireline broadband table",
                       max_values=2 if report_year == 2024 and concept in {"TelecomBroadbandConnections", "TelecomFiberBroadbandConnections"} else 3)

    latin_start = find_line(r"LATIN AMERICA SEGMENT\s+Percent Change")
    if latin_start is not None:
        latin_end = min(latin_start + 40, len(lines))
        for concept, label, row in (
            ("TelecomLatinAmericaRevenue", "Latin America segment revenue", r"Total Segment Operating Revenues\s+\$?"),
            ("TelecomLatinAmericaOperatingIncome", "Latin America segment operating income", r"Operating Income \(Loss\)\s+\$?"),
        ):
            series(concept, label, row, latin_start + 1, latin_end,
                   unit="USD", scale="millions", table="SEC 10-K Latin America segment results table")

    cash_flow_start = find_line(r"Consolidated Statements of Cash Flows\s*$")
    if cash_flow_start is not None:
        investing_start = find_line(r"Investing Activities\s*$", cash_flow_start + 1)
        cash_flow_end = investing_start or min(cash_flow_start + 90, len(lines))
        capex_pattern = r"Capital expenditures\s*"
        financing_start = find_line(r"Financing Activities\s*$", (investing_start or cash_flow_end) + 1)
        capex_row = find_line(capex_pattern, investing_start or cash_flow_start, financing_start or len(lines))
        if capex_row is not None:
            amounts = _reported_amounts_after_label(lines[capex_row], capex_pattern)
            for offset, cash_impact in enumerate(amounts[:3]):
                append_fact(
                    "TelecomCapitalExpenditures",
                    "Capital expenditures (cash outflow magnitude)",
                    abs(cash_impact),
                    report_year - offset,
                    "USD",
                    "millions",
                    "SEC 10-K Consolidated Statements of Cash Flows, Capital expenditures row",
                    [source_component(
                        "ReportedTelecomCapitalExpendituresCashImpact",
                        "Reported investing cash-flow impact from capital expenditures",
                        cash_impact,
                        report_year - offset,
                        "millions",
                        "SEC 10-K Consolidated Statements of Cash Flows, Capital expenditures row",
                    )],
                )

        working_capital_rows = (
            ("TelecomReceivablesCashImpact", r"Receivables\s+", "Receivables"),
            ("TelecomEquipmentInstallmentReceivablesCashImpact", r"Equipment installment receivables and related sales\s+", "Equipment installment receivables and related sales"),
            ("TelecomContractAssetCashImpact", r"Contract asset and cost deferral\s+", "Contract asset and cost deferral"),
            ("TelecomInventoryPrepaidsOtherCurrentAssetsCashImpact", r"Inventories, prepaid and other current assets\s+", "Inventories, prepaid and other current assets"),
            ("TelecomAccountsPayableAccruedLiabilitiesCashImpact", r"Accounts payable and other accrued liabilities\s+", "Accounts payable and other accrued liabilities"),
        )
        cash_impacts: dict[int, float] = {}
        components_by_year: dict[int, list[Dict[str, Any]]] = {}
        for concept, pattern, label in working_capital_rows:
            row_index = find_line(pattern, cash_flow_start, cash_flow_end)
            if row_index is None:
                continue
            amounts = _reported_amounts_after_label(lines[row_index], pattern)
            for offset, cash_impact in enumerate(amounts[:3]):
                year = report_year - offset
                cash_impacts[year] = cash_impacts.get(year, 0.0) + cash_impact
                components_by_year.setdefault(year, []).append(source_component(
                    concept,
                    f"Reported cash impact: {label}",
                    cash_impact,
                    year,
                    "millions",
                    f"SEC 10-K Consolidated Statements of Cash Flows, Changes in operating assets and liabilities, {label} row",
                ))
        for year, cash_impact in cash_impacts.items():
            if len(components_by_year.get(year, [])) != len(working_capital_rows):
                continue
            append_fact(
                "TelecomWorkingCapitalChange",
                "Change in operating working capital (investment/use of cash)",
                -cash_impact,
                year,
                "USD",
                "millions",
                "SEC 10-K cash-flow changes in receivables, equipment installment receivables, contract assets, current assets, and accounts payable; derived as negative total cash impact",
                components_by_year[year],
            )

    debt_total_pattern = r"Total long-term debt, including current maturities\s*"
    debt_total_row = find_line(debt_total_pattern)
    if debt_total_row is not None:
        amounts = _reported_amounts_after_label(lines[debt_total_row], debt_total_pattern)
        for offset, amount in enumerate(amounts[:3]):
            append_fact(
                "TelecomInterestBearingDebt",
                "Total long-term debt including current maturities",
                amount,
                report_year - offset,
                "USD",
                "millions",
                "SEC 10-K debt note, total long-term debt including current maturities; filing separately states whether short-term borrowings are outstanding",
            )

    debt_cost_pattern = re.compile(
        r"weighted average interest rate of our long-term debt portfolio.{0,180}?approximately\s+([0-9]+(?:\.[0-9]+)?)\s*%",
        flags=re.IGNORECASE,
    )
    debt_cost_match = next((debt_cost_pattern.search(line) for line in lines if debt_cost_pattern.search(line)), None)
    if debt_cost_match is not None:
        debt_cost_pct = float(debt_cost_match.group(1))
        debt_cost_line = next(line for line in lines if debt_cost_pattern.search(line))
        debt_cost_years = re.findall(r"(?:December\s+31,\s*)((?:19|20)\d{2})", debt_cost_line, flags=re.IGNORECASE)
        for year in sorted({int(item) for item in debt_cost_years if int(item) <= report_year}, reverse=True)[:2]:
            append_fact(
                "TelecomCostOfDebt",
                "Filed weighted-average long-term debt interest rate, including derivatives",
                debt_cost_pct,
                year,
                "percent",
                "annual",
                "SEC 10-K debt note, weighted-average interest rate of long-term debt portfolio",
            )

    return sorted(output, key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


async def _fetch_telecom_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    filings_by_year: dict[int, Dict[str, Any]] = {}
    for filing in source_filings:
        if filing.get("form") not in {"10-K", "10-K/A"}:
            continue
        try:
            report_year = int(str(filing.get("report_date") or "")[:4])
        except (TypeError, ValueError):
            continue
        existing = filings_by_year.get(report_year)
        if existing is None or str(filing.get("filing_date") or "") > str(existing.get("filing_date") or ""):
            filings_by_year[report_year] = filing
    annual_filings = sorted(filings_by_year.values(), key=lambda item: str(item.get("filing_date") or ""), reverse=True)[:2]
    if not annual_filings:
        return []
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
    except Exception as exc:
        logger.warning("Telecom SEC filings unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []

    facts_by_period: dict[tuple[str, int], Dict[str, Any]] = {}
    for filing_record in annual_filings:
        accession = str(filing_record.get("accession_number") or "")
        if not accession:
            continue
        try:
            filing = await asyncio.to_thread(filings.get, accession)
            filing_text = await asyncio.to_thread(_resilient_filing_text, filing)
        except Exception as exc:
            logger.warning("Telecom 10-K extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
            continue
        parsed = _telecom_filing_facts_from_text(
            filing_text,
            report_date=str(filing_record.get("report_date") or ""),
            filing_date=str(filing_record.get("filing_date") or ""),
            accession_number=accession,
            form=str(filing_record.get("form") or "10-K"),
            primary_document=filing_record.get("primary_document"),
        )
        for fact in parsed:
            key = (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0))
            existing = facts_by_period.get(key)
            if existing is None or str(fact.get("filing_date") or "") > str(existing.get("filing_date") or ""):
                facts_by_period[key] = fact
    return sorted(facts_by_period.values(), key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


async def _fetch_asset_manager_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    filings_by_year: dict[int, Dict[str, Any]] = {}
    for filing in source_filings:
        if filing.get("form") not in {"10-K", "10-K/A"}:
            continue
        try:
            report_year = int(str(filing.get("report_date") or "")[:4])
        except (TypeError, ValueError):
            continue
        current = filings_by_year.get(report_year)
        if current is None or str(filing.get("filing_date") or "") > str(current.get("filing_date") or ""):
            filings_by_year[report_year] = filing
    annual_filings = sorted(filings_by_year.values(), key=lambda item: str(item.get("filing_date") or ""), reverse=True)[:3]
    if not annual_filings:
        return []

    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
    except Exception as exc:
        logger.info("Asset-manager SEC filings unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []

    facts_by_period: dict[tuple[str, int], Dict[str, Any]] = {}
    for filing_record in annual_filings:
        accession = str(filing_record.get("accession_number") or "")
        if not accession:
            continue
        try:
            filing = await asyncio.to_thread(filings.get, accession)
            filing_text = await asyncio.to_thread(_resilient_filing_text, filing)
        except Exception as exc:
            logger.info("Asset-manager 10-K extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
            continue
        parsed_facts = _asset_manager_filing_facts_from_text(
            filing_text,
            report_date=str(filing_record.get("report_date") or ""),
            filing_date=str(filing_record.get("filing_date") or ""),
            accession_number=accession,
            form=str(filing_record.get("form") or "10-K"),
            primary_document=filing_record.get("primary_document"),
        )
        for fact in parsed_facts:
            key = (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0))
            existing = facts_by_period.get(key)
            is_derived = "derived as" in str(fact.get("source_statement") or "").lower()
            existing_is_derived = existing is not None and "derived as" in str(existing.get("source_statement") or "").lower()
            is_later_filing = existing is None or str(fact.get("filing_date") or "") > str(existing.get("filing_date") or "")
            if existing is None or (existing_is_derived and not is_derived) or (existing_is_derived == is_derived and is_later_filing):
                facts_by_period[key] = fact

    return sorted(facts_by_period.values(), key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


async def _fetch_reit_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    by_year: dict[int, Dict[str, Any]] = {}
    for filing in source_filings:
        if filing.get("form") != "10-K":
            continue
        report_date = str(filing.get("report_date") or "")
        if not report_date[:4].isdigit():
            continue
        year = int(report_date[:4])
        current = by_year.get(year)
        if current is None or str(filing.get("filing_date") or "") > str(current.get("filing_date") or ""):
            by_year[year] = filing
    annual_filings = sorted(by_year.values(), key=lambda item: str(item.get("filing_date") or ""), reverse=True)[:2]
    if not annual_filings:
        return []

    try:
        filings = await asyncio.to_thread(company.get_filings, form="10-K")
    except Exception as exc:
        logger.warning("REIT filing-table extraction unavailable (%s)", type(exc).__name__)
        return []

    output: list[Dict[str, Any]] = []
    for filing_record in annual_filings:
        try:
            filing = await asyncio.to_thread(filings.get, str(filing_record["accession_number"]))
            filing_text = await asyncio.to_thread(_resilient_filing_text, filing)
        except Exception as exc:
            logger.warning("REIT filing-table extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
            continue
        output.extend(_reit_filing_facts_from_text(
            filing_text,
            report_date=str(filing_record.get("report_date") or ""),
            filing_date=str(filing_record.get("filing_date") or ""),
            accession_number=str(filing_record.get("accession_number") or ""),
            form=str(filing_record.get("form") or "10-K"),
            primary_document=filing_record.get("primary_document"),
        ))
    return output


def _mortgage_reit_filing_facts_from_text(
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    lines = filing_text.splitlines()
    output: list[Dict[str, Any]] = []

    def append_fact(
        concept: str,
        label: str,
        value: float,
        year: int,
        unit: str,
        scale: str,
        statement: str,
    ) -> None:
        period_end = f"{year}{report_date[4:]}"
        output.append({
            "concept": concept,
            "label": label,
            "value": value,
            "unit": unit,
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": statement,
        })

    def find_line(pattern: str, start: int = 0, end: int | None = None) -> int | None:
        stop = len(lines) if end is None else min(end, len(lines))
        for index in range(start, stop):
            if re.match(pattern, re.sub(r"\s+", " ", lines[index]).strip(), flags=re.IGNORECASE):
                return index
        return None

    def series(
        concept: str,
        label: str,
        row_pattern: str,
        start: int,
        end: int,
        *,
        unit: str,
        scale: str,
        statement: str,
        take_last: bool = False,
        absolute: bool = False,
        limit: int = 3,
    ) -> None:
        index = find_line(row_pattern, start, end)
        if index is None:
            return
        values = _reported_amounts_after_label(lines[index], row_pattern)
        values = values[-limit:] if take_last else values[:limit]
        for offset, value in enumerate(values):
            append_fact(concept, label, abs(value) if absolute else value, report_year - offset, unit, scale, statement)

    selected_start = find_line(r"Selected Financial Data\s*$")
    if selected_start is None:
        return []
    balance_start = find_line(r"Balance Sheet Data\s+", selected_start, selected_start + 25)
    income_start = find_line(r"Statement of Comprehensive Income Data\s+", (balance_start or selected_start) + 1, selected_start + 80)
    other_start = find_line(r"Other Data \(Unaudited\)", (income_start or selected_start) + 1, selected_start + 120)
    if balance_start is None or income_start is None or other_start is None:
        return []
    balance_end = income_start
    income_end = other_start
    other_end = min(other_start + 36, len(lines))

    balance_rows = (
        ("MortgageReitInvestmentSecuritiesFairValue", "Investment securities and other mortgage credit investments at fair value", r"Investment securities, at fair value of", "USD", "millions", True, False),
        ("MortgageReitTotalAssets", "Total assets", r"Total assets\s+\$?", "USD", "millions", False, False),
        ("MortgageReitRepoAndOtherDebt", "Repurchase agreements and other debt", r"Repurchase agreements and other debt\s+\$?", "USD", "millions", False, False),
        ("MortgageReitTotalLiabilities", "Total liabilities", r"Total liabilities\s+\$?", "USD", "millions", False, False),
        ("MortgageReitTotalStockholdersEquity", "Total stockholders' equity", r"Total stockholders' equity\s+\$?", "USD", "millions", False, False),
        ("MortgageReitNetBookValuePerCommonShare", "Net book value per common share", r"Net book value per common share\s+\d?", "USD per share", "actual", False, False),
        ("MortgageReitTangibleBookValuePerCommonShare", "Tangible net book value per common share", r"Tangible net book value per common share\s+\d?", "USD per share", "actual", False, False),
    )
    for concept, label, pattern, unit, scale, take_last, absolute in balance_rows:
        series(concept, label, pattern, balance_start + 1, balance_end, unit=unit, scale=scale,
               statement="SEC 10-K selected financial data, balance sheet table", take_last=take_last, absolute=absolute)

    balance_sheet_start = find_line(r"Consolidated Balance Sheets\s*$")
    if balance_sheet_start is not None:
        preferred_pattern = r"Preferred Stock - aggregate liquidation preference"
        preferred_index = find_line(preferred_pattern, balance_sheet_start + 1, min(balance_sheet_start + 45, len(lines)))
        if preferred_index is not None:
            preferred_label = re.sub(r"\s+", " ", lines[preferred_index]).strip()
            preference_match = re.search(
                r"Preferred Stock - aggregate liquidation preference of\s+\$?\s*([\d,]+)(?:\s+and\s+\$?\s*([\d,]+),?\s+respectively)?",
                preferred_label,
                flags=re.IGNORECASE,
            )
            if preference_match:
                preference_values = [float(value.replace(",", "")) for value in preference_match.groups() if value]
                # Some AGNC comparative balance sheets state one preference amount because it applies to
                # both presented years; the following table cells are carrying values, not liquidation preference.
                if len(preference_values) == 1:
                    preference_values.append(preference_values[0])
                for offset, value in enumerate(preference_values[:2]):
                    append_fact(
                        "MortgageReitPreferredEquityLiquidationPreference",
                        "Preferred stock aggregate liquidation preference",
                        value,
                        report_year - offset,
                        "USD",
                        "millions",
                        "SEC 10-K consolidated balance sheet, preferred stock liquidation-preference label",
                    )
        preferred_carry_pattern = r"Preferred Stock - aggregate liquidation preference"
        index = find_line(preferred_carry_pattern, balance_sheet_start + 1, min(balance_sheet_start + 45, len(lines)))
        if index is not None:
            values = _reported_amounts_after_label(lines[index], preferred_carry_pattern)
            for offset, value in enumerate(values[-2:]):
                append_fact(
                    "MortgageReitPreferredEquityCarryingValue",
                    "Preferred stock carrying value",
                    value,
                    report_year - offset,
                    "USD",
                    "millions",
                    "SEC 10-K consolidated balance sheet, preferred stock line",
                )

        common_line = find_line(r"Common stock - \$?", balance_sheet_start + 1, min(balance_sheet_start + 45, len(lines)))
        if common_line is not None:
            normalized_line = re.sub(r"\s+", " ", lines[common_line]).strip()
            share_matches = re.search(
                r"([0-9,]+(?:\.[0-9]+)?)\s+and\s+([0-9,]+(?:\.[0-9]+)?)\s+shares issued and outstanding",
                normalized_line,
                flags=re.IGNORECASE,
            )
            if share_matches:
                for offset, capture in enumerate(share_matches.groups()):
                    append_fact(
                        "MortgageReitPeriodEndCommonShares",
                        "Common shares issued and outstanding at period end",
                        float(capture.replace(",", "")),
                        report_year - offset,
                        "shares",
                        "millions",
                        "SEC 10-K consolidated balance sheet, common stock line",
                    )

    income_rows = (
        ("MortgageReitGAAPInterestIncome", "GAAP interest income", r"Interest income\s+\$?", "USD", "millions", False, False),
        ("MortgageReitGAAPInterestExpense", "GAAP interest expense", r"Interest expense\s+\$?", "USD", "millions", False, False),
        ("MortgageReitGAAPNetInterestIncome", "GAAP net interest income", r"Net interest income \(expense\)\s+\$?", "USD", "millions", False, False),
        ("MortgageReitOtherGainNet", "Other gain, net", r"Other gain, net\s+\$?", "USD", "millions", False, False),
        ("MortgageReitOperatingExpenses", "Operating expenses", r"Operating expenses\s+\$?", "USD", "millions", False, False),
        ("MortgageReitNetIncome", "Net income", r"Net income\s+\$?", "USD", "millions", False, False),
        ("MortgageReitPreferredDividends", "Dividends on preferred stock", r"Dividends on preferred stock\s+\$?", "USD", "millions", False, False),
        ("MortgageReitNetIncomeAvailableToCommon", "Net income available to common stockholders", r"Net income available to common stockholders\s+\$?", "USD", "millions", False, False),
        ("MortgageReitComprehensiveIncomeAvailableToCommon", "Comprehensive income available to common stockholders", r"Comprehensive income available to common stockholders\s+\$?", "USD", "millions", False, False),
        ("MortgageReitOtherComprehensiveIncome", "Other comprehensive income (loss), net", r"Other comprehensive income \(loss\), net\s+", "USD", "millions", False, False),
        ("MortgageReitCommonDividendsPerShareDeclared", "Dividends declared per common share", r"Dividends declared per common share\s+\$?", "USD per share", "actual", False, False),
    )
    for concept, label, pattern, unit, scale, take_last, absolute in income_rows:
        series(concept, label, pattern, income_start + 1, income_end, unit=unit, scale=scale,
               statement="SEC 10-K selected financial data, comprehensive income table", take_last=take_last, absolute=absolute)

    for concept, label, pattern, unit, scale in (
        ("MortgageReitAverageInvestmentSecuritiesAtCost", "Average investment securities at cost", r"Average investment securities - at cost\s+\$?", "USD", "millions"),
        ("MortgageReitAverageTbaDollarRollPositionAtCost", "Average net TBA dollar roll position at cost", r"Average net TBA dollar roll position - at cost\s+\$?", "USD", "millions"),
        ("MortgageReitAverageTotalAssetsFairValue", "Average total assets at fair value", r"Average total assets - at fair value\s+\$?", "USD", "millions"),
        ("MortgageReitAverageRepoBorrowings", "Average repurchase agreements and other debt outstanding", r"Average repurchase agreements and other debt outstanding\s*\d?\s+\$?", "USD", "millions"),
        ("MortgageReitAverageStockholdersEquity", "Average stockholders' equity", r"Average stockholders' equity\s*\d?\s+\$?", "USD", "millions"),
        ("MortgageReitEconomicReturnOnTangibleCommonEquity", "Economic return on tangible common equity", r"Economic return on tangible common equity\s*\d?\s+", "percent", "annual"),
        ("MortgageReitExpensesPctAverageAssets", "Expenses as a percent of average total assets", r"Expenses % of average total assets\s+", "percent", "annual"),
    ):
        series(concept, label, pattern, other_start + 1, other_end, unit=unit, scale=scale,
               statement="SEC 10-K selected financial data, average balance and leverage table")

    # 7.4:1 style leverage rows need a ratio-specific parser because commas separate thousands elsewhere.
    for concept, label, pattern in (
        ("MortgageReitAverageAtRiskLeverage", "Average tangible net book value at-risk leverage", r"Average tangible net book value .at risk. leverage\s+"),
        ("MortgageReitPeriodEndAtRiskLeverage", "Period-end tangible net book value at-risk leverage", r"Tangible net book value .at risk. leverage \(as of period end\)\s+"),
    ):
        index = find_line(pattern, other_start + 1, other_end)
        if index is not None:
            ratios = [float(value) for value in re.findall(r"(?<!\d)(\d+(?:\.\d+)?)\s*:\s*1", lines[index])]
            for offset, value in enumerate(ratios[:3]):
                append_fact(concept, label, value, report_year - offset, "multiple", "times",
                            "SEC 10-K selected financial data, average balance and leverage table")

    spread_start = find_line(r"Investment and TBA Securities - Net Interest Spread", 1000)
    if spread_start is not None:
        spread_end = min(spread_start + 15, len(lines))
        for concept, label, pattern, absolute in (
            ("MortgageReitAverageAssetYield", "Average asset yield", r"Average asset yield\s+", False),
            ("MortgageReitAverageAggregateCostOfFunds", "Average aggregate cost of funds", r"Average aggregate cost of funds\s+", True),
            ("MortgageReitAverageNetInterestSpread", "Average net interest spread", r"Average net interest spread\s+", False),
        ):
            series(concept, label, pattern, spread_start + 1, spread_end, unit="percent", scale="annual",
                   statement="SEC 10-K economic investment/TBA net interest spread table", absolute=absolute)

    debt_cost_start = find_line(r"Economic Interest Expense and Aggregate Cost of Funds", 1000)
    if debt_cost_start is not None:
        debt_cost_end = min(debt_cost_start + 35, len(lines))
        row_index = find_line(r"Total economic interest expense \(non-GAAP measure\)\s+\$?", debt_cost_start + 1, debt_cost_end)
        if row_index is not None:
            values = _reported_amounts_after_label(lines[row_index], r"Total economic interest expense \(non-GAAP measure\)\s+\$?")
            amount_values = values[::2]
            for offset, amount in enumerate(amount_values[:3]):
                append_fact(
                    "MortgageReitEconomicInterestExpense",
                    "Total economic interest expense including TBA and swap settlements",
                    amount,
                    report_year - offset,
                    "USD",
                    "millions",
                    "SEC 10-K economic interest expense and cost-of-funds table, amount column",
                )

        for concept, label, pattern, unit, scale in (
            ("MortgageReitAverageMortgageBorrowings", "Average mortgage borrowings outstanding", r"Average mortgage borrowings outstanding\s+\$?", "USD", "millions"),
            ("MortgageReitAverageSwapNotional", "Average notional interest rate swap amount", r"Average notional amount of interest rate swaps outstanding.*?\$?", "USD", "millions"),
            ("MortgageReitAverageSwapRatio", "Average interest rate swap ratio to mortgage borrowings", r"Ratio of average interest rate swaps to mortgage borrowings outstanding\s+", "percent", "annual"),
            ("MortgageReitAverageSwapNetPayRate", "Average interest rate swap net pay/(receive) rate", r"Average interest rate swap net pay/\(receive\) rate\s+", "percent", "annual"),
        ):
            series(concept, label, pattern, debt_cost_start + 1, min(debt_cost_start + 70, len(lines)),
                   unit=unit, scale=scale, statement="SEC 10-K economic funding and hedge balance table",
                   absolute=concept == "MortgageReitAverageSwapNotional")

    economic_income_start = find_line(r"Economic Interest Income and Asset Yields\s*$")
    if economic_income_start is not None:
        economic_income_end = min(economic_income_start + 42, len(lines))
        # The footnote marker "3" follows this row label in AGNC's table. Match it
        # explicitly so it is not mistaken for the first annual dollar amount.
        income_pattern = r"Economic interest income \(non-GAAP measure\)\s+3\s+\$?"
        income_index = find_line(income_pattern, economic_income_start + 1, economic_income_end)
        if income_index is not None:
            amounts = _reported_amounts_after_label(lines[income_index], income_pattern)
            for offset, amount in enumerate(amounts[::2][:3]):
                append_fact(
                    "MortgageReitEconomicInterestIncome",
                    "Economic interest income including implied TBA dollar roll income",
                    amount,
                    report_year - offset,
                    "USD",
                    "millions",
                    "SEC 10-K economic interest income and asset yield table, amount column",
                )

    return sorted(output, key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


async def _fetch_mortgage_reit_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    filings_by_year: dict[int, Dict[str, Any]] = {}
    for filing in source_filings:
        if filing.get("form") not in {"10-K", "10-K/A"}:
            continue
        try:
            report_year = int(str(filing.get("report_date") or "")[:4])
        except (TypeError, ValueError):
            continue
        existing = filings_by_year.get(report_year)
        if existing is None or str(filing.get("filing_date") or "") > str(existing.get("filing_date") or ""):
            filings_by_year[report_year] = filing
    annual_filings = sorted(filings_by_year.values(), key=lambda item: str(item.get("filing_date") or ""), reverse=True)[:2]
    if not annual_filings:
        return []
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
    except Exception as exc:
        logger.warning("Mortgage-REIT SEC filings unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []
    by_concept_period: dict[tuple[str, int], Dict[str, Any]] = {}
    for filing_record in annual_filings:
        accession = str(filing_record.get("accession_number") or "")
        if not accession:
            continue
        try:
            filing = await asyncio.to_thread(filings.get, accession)
            text = await asyncio.to_thread(_resilient_filing_text, filing)
        except Exception as exc:
            logger.warning("Mortgage-REIT 10-K extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
            continue
        parsed = _mortgage_reit_filing_facts_from_text(
            text,
            report_date=str(filing_record.get("report_date") or ""),
            filing_date=str(filing_record.get("filing_date") or ""),
            accession_number=accession,
            form=str(filing_record.get("form") or "10-K"),
            primary_document=filing_record.get("primary_document"),
        )
        for fact in parsed:
            key = (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0))
            existing = by_concept_period.get(key)
            if existing is None or str(fact.get("filing_date") or "") > str(existing.get("filing_date") or ""):
                by_concept_period[key] = fact
    return sorted(by_concept_period.values(), key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


def _table_numeric_cell_value(value: str) -> float | None:
    normalized = re.sub(r"\s+", " ", value).strip().replace("$", "").replace(",", "")
    if not normalized or normalized in {"—", "–", "-"}:
        return None
    negative = normalized.startswith("(") and normalized.endswith(")")
    normalized = normalized.strip("() ")
    try:
        parsed = float(normalized)
    except ValueError:
        return None
    return -parsed if negative else parsed


def _pharma_filing_facts_from_html(
    filing_html: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    """Extract Pfizer's product-revenue and patent tables without inferring global LOE."""
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []
    soup = BeautifulSoup(filing_html, "lxml")
    output: list[Dict[str, Any]] = []

    def append_fact(
        metric: str,
        product_name: str,
        value: float,
        year: int,
        unit: str,
        scale: str,
        statement: str,
        *,
        indication: str | None = None,
        region: str | None = None,
        reported_text: str | None = None,
    ) -> None:
        period_end = f"{year}-12-31"
        output.append({
            "metric": metric,
            "product_name": product_name,
            "indication": indication,
            "region": region,
            "value": value,
            "unit": unit,
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": statement,
            "reported_text": reported_text,
        })

    def rows_for(table: Any) -> list[list[str]]:
        return [[cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"], recursive=False)]
            for row in table.find_all("tr")]

    def values_after(cells: list[str], index: int) -> list[float]:
        return [number for cell in cells[index:] if (number := _table_numeric_cell_value(cell)) is not None]

    product_table = next((table for table in soup.find_all("table") if (
        "TOTAL REVENUES" in " ".join(table.stripped_strings)
        and "PRODUCT PRIMARY INDICATION OR CLASS" in " ".join(table.stripped_strings)
    )), None)
    if product_table is not None:
        rows = rows_for(product_table)
        header = next((row for row in rows if row and row[0].strip().upper() == "PRODUCT"), [])
        fiscal_years = [int(year) for cell in header for year in re.findall(r"20\d{2}", cell)][:3]
        if len(fiscal_years) == 3 and fiscal_years[0] == report_year:
            for row in rows:
                if len(row) < 4:
                    continue
                product_name = row[0].strip()
                if product_name.upper() == "TOTAL REVENUES":
                    numbers = values_after(row, 1)
                    if len(numbers) >= 3:
                        for year, value in zip(fiscal_years, numbers[-3:], strict=True):
                            append_fact("reported_total_revenue", "Total revenues", value, year, "USD", "millions",
                                "SEC 10-K Note 17, Significant Revenues by Product; total revenue row")
                    continue
                if not product_name or product_name.upper() == "PRODUCT":
                    continue
                indication = row[2].strip() if len(row) > 2 else ""
                if not indication or indication == "$" or indication.upper() == "PRIMARY INDICATION OR CLASS":
                    continue
                numbers = values_after(row, 3)
                if len(numbers) < 3:
                    continue
                for year, value in zip(fiscal_years, numbers[-3:], strict=True):
                    append_fact("product_revenue", product_name, value, year, "USD", "millions",
                        "SEC 10-K Note 17, Significant Revenues by Product", indication=indication)

    balance_sheet = next((table for table in soup.find_all("table") if (
        "Short-term investments" in " ".join(table.stripped_strings)
        and "Total current assets" in " ".join(table.stripped_strings)
        and "Total liabilities" in " ".join(table.stripped_strings)
    )), None)
    if balance_sheet is not None:
        for row in rows_for(balance_sheet):
            if not row or row[0].strip().lower() != "short-term investments":
                continue
            for offset, value in enumerate(values_after(row, 1)[:2]):
                year = report_year - offset
                append_fact("marketable_securities", "Short-term investments", value, year, "USD", "millions",
                    "SEC 10-K consolidated balance sheet, short-term investments", reported_text=row[0].strip())

    for table in soup.find_all("table"):
        table_text = " ".join(table.stripped_strings)
        if "U.S. Basic Product Patent Expiration Year" not in table_text or "Major Europe Basic Product Patent Expiration Year" not in table_text:
            continue
        for row in rows_for(table):
            if len(row) < 7:
                continue
            product_name = row[0].strip()
            if not product_name or product_name.lower() == "product":
                continue
            for region, column in (("us", 2), ("major_europe", 4), ("japan", 6)):
                reported_text = row[column].strip() if column < len(row) else ""
                expiry_match = re.search(r"(?<!\d)(20\d{2})(?!\d)", reported_text)
                if not expiry_match:
                    continue
                append_fact("basic_patent_expiration_year", product_name, float(expiry_match.group(1)), report_year,
                    "calendar year", "actual", f"SEC 10-K Item 1, {region} basic product-patent-expiration table",
                    region=region, reported_text=reported_text)
                extension_match = re.search(r"\((20\d{2}) pending (?:PTE|SPC)\)", reported_text, flags=re.IGNORECASE)
                if extension_match:
                    append_fact("pending_patent_term_extension_year", product_name, float(extension_match.group(1)), report_year,
                        "calendar year", "actual", f"SEC 10-K Item 1, {region} patent-term-extension disclosure",
                        region=region, reported_text=reported_text)
    return sorted(output, key=lambda fact: (
        str(fact.get("metric") or ""), str(fact.get("product_name") or ""),
        str(fact.get("region") or ""), int(fact.get("fiscal_year") or 0),
    ))


async def _fetch_pharma_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    annual_filings = [filing for filing in source_filings if filing.get("form") in {"10-K", "10-K/A"}]
    annual_filings.sort(key=lambda row: str(row.get("filing_date") or ""), reverse=True)
    if not annual_filings:
        return []
    filing_record = annual_filings[0]
    accession = str(filing_record.get("accession_number") or "")
    if not accession:
        return []
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
        filing = await asyncio.to_thread(filings.get, accession)
        html = await asyncio.to_thread(_resilient_filing_html, filing)
    except Exception as exc:
        logger.warning("Pharma SEC extraction unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []
    return _pharma_filing_facts_from_html(
        html,
        report_date=str(filing_record.get("report_date") or ""),
        filing_date=str(filing_record.get("filing_date") or ""),
        accession_number=accession,
        form=str(filing_record.get("form") or "10-K"),
        primary_document=filing_record.get("primary_document"),
    )


def _biotech_pipeline_assets_from_html(
    filing_html: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    """Extract MRNA candidate identifiers and nearby SEC narrative without estimating value."""
    filing_text = re.sub(r"\s+", " ", BeautifulSoup(filing_html, "lxml").get_text(" ", strip=True))
    marker = "we currently have three commercial products"
    start = filing_text.lower().find(marker)
    if start < 0:
        return []
    section_end = re.search(r"\bItem\s+1A\.?\s+Risk Factors\b", filing_text[start:], re.IGNORECASE)
    end = start + section_end.start() if section_end else len(filing_text)
    business = filing_text[start:end]
    if not business:
        return []

    paused_ids: set[str] = set()
    paused_marker = "paused development of"
    paused_at = business.lower().find(paused_marker)
    if paused_at >= 0:
        paused_match = re.search(r"paused development of\s*(.*?)(?:,\s*which were|[.;])", business[paused_at:], re.IGNORECASE)
        if paused_match:
            paused_ids.update(match.group(0).lower() for match in re.finditer(r"\bmRNA-\d{3,4}\b", paused_match.group(1), re.IGNORECASE))
    no_current_marker = "do not have current plans for future development of the following programs"
    no_current_at = business.lower().find(no_current_marker)
    if no_current_at >= 0:
        paused_text = business[no_current_at:no_current_at + 1800]
        paused_ids.update(match.group(0).lower() for match in re.finditer(r"\bmRNA-\d{3,4}\b", paused_text, re.IGNORECASE))

    commercial_ids = {"mrna-1273", "mrna-1283", "mrna-1345"}
    matches = list(re.finditer(r"\bmRNA-\d{3,4}\b", business, re.IGNORECASE))
    positions: dict[str, list[Any]] = {}
    for match in matches:
        positions.setdefault(match.group(0).lower(), []).append(match)
    assets: list[Dict[str, Any]] = []
    for normalized_id, asset_matches in positions.items():
        if normalized_id in commercial_ids:
            continue
        asset_id = asset_matches[0].group(0)
        contexts: list[str] = []
        stage_candidates: list[tuple[int, str]] = []
        partner_candidates: list[str] = []
        for occurrence_index, occurrence in enumerate(asset_matches):
            sentence_start = max(business.rfind(".", 0, occurrence.start()), business.rfind(";", 0, occurrence.start())) + 1
            sentence_end = business.find(".", occurrence.end())
            if sentence_end < 0:
                sentence_end = len(business)
            sentence = business[sentence_start:sentence_end + 1].strip()
            if sentence and sentence not in contexts:
                contexts.append(sentence)
            stage_pattern = r"\b(?:Phase\s*[1-3](?:\s*/\s*[1-3])?|registrational study|regulatory filings? under review|BLA accepted for review)\b"
            for stage_match in re.finditer(stage_pattern, sentence, re.IGNORECASE):
                distance = abs(sentence_start + stage_match.start() - occurrence.start())
                stage_candidates.append((distance, re.sub(r"\s+", " ", stage_match.group(0)).strip()))
            next_identifier = min(
                (candidate.start() for candidate in matches if candidate.start() > occurrence.start()),
                default=min(len(business), occurrence.end() + 500),
            )
            if occurrence_index == 0:
                partner_context = business[occurrence.end():min(next_identifier, occurrence.end() + 550)]
                partner_match = re.search(r"\b(Merck|Recordati|Immatics|Vertex|ILCM|Gates Foundation)\b", partner_context, re.IGNORECASE)
                if partner_match:
                    partner_candidates.append(partner_match.group(1))
        stage = min(stage_candidates, key=lambda item: item[0])[1] if stage_candidates else None
        partner = "; ".join(partner_candidates) if partner_candidates else None
        assets.append({
            "asset_id": asset_id,
            "asset_name": asset_id,
            "stage": stage,
            "development_status": "explicitly_paused" if normalized_id in paused_ids else "disclosed",
            "partner": partner,
            "accession_number": accession_number,
            "filing_date": filing_date,
            "report_date": report_date,
            "form": form,
            "primary_document": primary_document,
            "source_statement": f"SEC 10-K Item 1, Business: {' | '.join(contexts)[:900]}",
        })
    return assets


async def _fetch_biotech_pipeline_assets(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    annual_filings = [filing for filing in source_filings if filing.get("form") in {"10-K", "10-K/A"}]
    annual_filings.sort(key=lambda row: str(row.get("filing_date") or ""), reverse=True)
    if not annual_filings:
        return []
    filing_record = annual_filings[0]
    accession = str(filing_record.get("accession_number") or "")
    if not accession:
        return []
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
        filing = await asyncio.to_thread(filings.get, accession)
        html = await asyncio.to_thread(_resilient_filing_html, filing)
    except Exception as exc:
        logger.warning("Biotech pipeline extraction unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []
    return _biotech_pipeline_assets_from_html(
        html,
        report_date=str(filing_record.get("report_date") or ""),
        filing_date=str(filing_record.get("filing_date") or ""),
        accession_number=accession,
        form=str(filing_record.get("form") or "10-K"),
        primary_document=filing_record.get("primary_document"),
    )


def _energy_filing_facts_from_html(
    filing_html: str,
    filing_text: str,
    *,
    report_date: str,
    filing_date: str,
    accession_number: str,
    form: str,
    primary_document: str | None,
) -> list[Dict[str, Any]]:
    """Read only the XOM table structures used by the integrated-energy model."""
    try:
        report_year = int(report_date[:4])
    except (TypeError, ValueError):
        return []

    soup = BeautifulSoup(filing_html, "lxml")
    tables = soup.find_all("table")
    output: list[Dict[str, Any]] = []

    def append_fact(
        concept: str,
        label: str,
        value: float,
        year: int,
        unit: str,
        scale: str,
        statement: str,
        *,
        components: list[Dict[str, Any]] | None = None,
    ) -> Dict[str, Any]:
        period_end = f"{year}-12-31"
        fact = {
            "concept": concept,
            "label": label,
            "value": value,
            "unit": unit,
            "unit_scale": scale,
            "period_end": period_end,
            "fiscal_year": year,
            "fiscal_period": "FY",
            "accession_number": accession_number,
            "filing_date": filing_date,
            "form": form,
            "report_date": period_end,
            "primary_document": primary_document,
            "source_statement": statement,
        }
        if components:
            fact["source_components"] = components
        output.append(fact)
        return fact

    def component_from(fact: Dict[str, Any]) -> Dict[str, Any]:
        return {key: fact[key] for key in (
            "concept", "label", "value", "unit", "unit_scale", "period_end", "fiscal_year",
            "fiscal_period", "accession_number", "filing_date", "form", "report_date",
            "primary_document", "source_statement",
        )}

    def rows_for(table: Any) -> list[list[str]]:
        result: list[list[str]] = []
        for row in table.find_all("tr"):
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"], recursive=False)]
            if cells:
                result.append(cells)
        return result

    def numbers(cells: list[str]) -> list[float]:
        return [number for value in cells if (number := _table_numeric_cell_value(value)) is not None]

    production_table = next((table for table in tables if all(
        marker in " ".join(table.stripped_strings)
        for marker in ("Total liquids production", "Total natural gas production available for sale", "Oil-equivalent production")
    )), None)
    if production_table is not None:
        table_rows = rows_for(production_table)

        def row_values(label: str, occurrence: int = 0) -> list[float]:
            matches = [row for row in table_rows if row[0].strip().lower().startswith(label.lower())]
            if occurrence >= len(matches):
                return []
            return numbers(matches[occurrence][1:])

        for concept, label, unit, scale, count in (
            ("EnergyTotalLiquidsProduction", "Total liquids production", "barrels per day", "thousands", 3),
            ("EnergyTotalNaturalGasProduction", "Total natural gas production available for sale", "cubic feet per day", "millions", 3),
            ("EnergyOilEquivalentProduction", "Oil-equivalent production", "barrels of oil equivalent per day", "thousands", 3),
        ):
            values = row_values(label)
            for offset, value in enumerate(values[:count]):
                append_fact(concept, label, value, report_year - offset, unit, scale,
                    "SEC 10-K supplemental production table; total includes the issuer's reported share of equity-company production")

        for section_label, concept, label in (
            ("Bitumen production", "EnergyBitumenProduction", "Bitumen production, consolidated subsidiaries"),
            ("Synthetic oil production", "EnergySyntheticOilProduction", "Synthetic oil production, consolidated subsidiaries"),
        ):
            section_index = next((index for index, row in enumerate(table_rows) if row[0].strip().lower() == section_label.lower()), None)
            if section_index is not None:
                component_row = next((row for row in table_rows[section_index + 1:section_index + 5]
                    if row[0].strip().lower().startswith("canada/other americas")), None)
                if component_row:
                    for offset, value in enumerate(numbers(component_row[1:])[:3]):
                        append_fact(concept, label, value, report_year - offset, "barrels per day", "thousands",
                            "SEC 10-K supplemental production table, consolidated-subsidiary regional row")

        for concept, label, scope_row, number_index in (
            ("EnergyTotalCrudeOilProduction", "Total crude oil production", "Total crude oil and natural gas liquids production", 0),
            ("EnergyTotalNGLProduction", "Total natural gas liquids production", "Total crude oil and natural gas liquids production", 1),
        ):
            values = row_values(scope_row)
            for offset, value in enumerate(values[number_index::2][:3]):
                append_fact(concept, label, value, report_year - offset, "barrels per day", "thousands",
                    "SEC 10-K supplemental production table; total includes consolidated subsidiaries and the issuer's proportionate share of equity companies")

        for scope_label, scope_concept, table_label, pair_index in (
            ("Total Consolidated Subsidiaries", "EnergyConsolidated", "Total crude oil and natural gas liquids production", 0),
            ("Total Equity Companies", "EnergyEquityCompany", "Total crude oil and natural gas liquids production", 1),
        ):
            rows = [row for row in table_rows if row[0].strip().lower() == scope_label.lower()]
            if rows:
                values = numbers(rows[0][1:])
                for commodity, number_index in (("CrudeOil", 0), ("NGL", 1)):
                    for offset, value in enumerate(values[number_index::2][:3]):
                        append_fact(f"{scope_concept}{commodity}Production", f"{scope_label} {commodity} production", value,
                            report_year - offset, "barrels per day", "thousands",
                            "SEC 10-K supplemental production table; reported ownership scope preserved")

        gas_start = next((index for index, row in enumerate(table_rows)
            if row[0].strip().lower() == "natural gas production available for sale"), None)
        if gas_start is not None:
            gas_rows = table_rows[gas_start:]
            for scope_label, scope_concept in (
                ("Total Consolidated Subsidiaries", "EnergyConsolidatedGasProduction"),
                ("Total Equity Companies", "EnergyEquityCompanyGasProduction"),
            ):
                row = next((item for item in gas_rows if item[0].strip().lower() == scope_label.lower()), None)
                if row:
                    for offset, value in enumerate(numbers(row[1:])[:3]):
                        append_fact(scope_concept, scope_label, value, report_year - offset,
                            "cubic feet per day", "millions",
                            "SEC 10-K supplemental production table; reported ownership scope preserved")

    for table in tables:
        table_text = " ".join(table.stripped_strings)
        if "Average production costs, per oil-equivalent barrel - total" not in table_text or "Average production prices" not in table_text:
            continue
        year: int | None = None
        scope = ""
        rows = rows_for(table)
        for row in rows:
            label = row[0].strip()
            year_match = re.fullmatch(r"20\d{2}", label)
            if year_match:
                year = int(label)
            if label.lower() in {"consolidated subsidiaries", "equity companies", "total"}:
                scope = label
                continue
            if year is None or scope.lower() != "total":
                continue
            norm_label = re.sub(r"\s+", " ", label).strip().lower()
            if norm_label in {"crude oil, per barrel", "ngl, per barrel"}:
                concept = "EnergyTotalCrudePrice" if norm_label.startswith("crude") else "EnergyTotalNGLPrice"
                value_list = numbers(row[1:])
                if value_list:
                    append_fact(concept, label, value_list[-1], year, "USD per barrel", "actual",
                        "SEC 10-K Production Prices and Production Costs table; total row combines consolidated subsidiaries and equity companies")
            elif norm_label == "natural gas, per thousand cubic feet":
                value_list = numbers(row[1:])
                if value_list:
                    append_fact("EnergyTotalNaturalGasPrice", label, value_list[-1], year,
                        "USD per thousand cubic feet", "actual",
                        "SEC 10-K Production Prices and Production Costs table; total row combines consolidated subsidiaries and equity companies")
            elif norm_label in {"bitumen, per barrel", "synthetic oil, per barrel"}:
                value_list = numbers(row[1:])
                if value_list:
                    concept = "EnergyTotalBitumenPrice" if norm_label.startswith("bitumen") else "EnergyTotalSyntheticOilPrice"
                    append_fact(concept, label, value_list[-1], year, "USD per barrel", "actual",
                        "SEC 10-K Production Prices and Production Costs table; total row combines reported production scopes")
            elif norm_label.startswith("average production costs, per oil-equivalent barrel - total"):
                value_list = numbers(row[1:])
                if value_list:
                    append_fact("EnergyProductionCostPerOilEquivalentBarrel", label, value_list[-1], year,
                        "USD per barrel of oil equivalent", "actual",
                        "SEC 10-K Production Prices and Production Costs table; total row combines consolidated subsidiaries and equity companies")

    reserve_inputs: dict[tuple[int, str, str], Dict[str, Any]] = {}
    for table in tables:
        table_text = " ".join(table.stripped_strings)
        if "Proved developed reserves" not in table_text or "Proved undeveloped reserves" not in table_text or "Total proved reserves at December 31" not in table_text:
            continue
        year: int | None = None
        reserve_type: str | None = None
        for row in rows_for(table):
            label = row[0].strip()
            year_match = re.search(r"(?:As of|Total proved reserves at) December 31,\s*(20\d{2})", label, flags=re.I)
            if year_match:
                year = int(year_match.group(1))
                if label.lower().startswith("total proved reserves"):
                    values = numbers(row[1:])
                    if values:
                        append_fact("EnergyTotalProvedOilEquivalentReserves", label, values[-1], year,
                            "barrels of oil equivalent", "millions",
                            "SEC 10-K supplemental proved-reserves table, total oil-equivalent column")
                    reserve_type = None
                    continue
                reserve_type = None
            if label.lower() == "proved developed reserves":
                reserve_type = "developed"
                continue
            if label.lower() == "proved undeveloped reserves":
                reserve_type = "undeveloped"
                continue
            scope = "consolidated" if label.lower() == "consolidated subsidiaries" else "equity" if label.lower() == "equity companies" else None
            if year is None or reserve_type is None or scope is None:
                continue
            values = numbers(row[1:])
            if not values:
                continue
            concept = f"Energy{reserve_type.title()}OilEquivalentReserves{scope.title()}"
            fact = append_fact(concept, f"{label}: {reserve_type} oil-equivalent reserves", values[-1], year,
                "barrels of oil equivalent", "millions",
                "SEC 10-K supplemental proved-reserves table; ownership scope and final oil-equivalent column preserved")
            reserve_inputs[(year, reserve_type, scope)] = fact
    for year in {key[0] for key in reserve_inputs}:
        for reserve_type in ("developed", "undeveloped"):
            consolidated = reserve_inputs.get((year, reserve_type, "consolidated"))
            equity = reserve_inputs.get((year, reserve_type, "equity"))
            if consolidated and equity:
                concept = f"Energy{reserve_type.title()}OilEquivalentReserves"
                append_fact(concept, f"Total {reserve_type} oil-equivalent reserves", consolidated["value"] + equity["value"], year,
                    "barrels of oil equivalent", "millions",
                    "Derived from SEC 10-K proved-reserves table; consolidated subsidiaries plus proportionate equity-company reserves",
                    components=[component_from(consolidated), component_from(equity)])

    source_segments = (
        ("Upstream", "EnergyUpstreamEarningsGAAP"),
        ("Energy Products", "EnergyProductsEarningsGAAP"),
        ("Chemical Products", "EnergyChemicalProductsEarningsGAAP"),
        ("Specialty Products", "EnergySpecialtyProductsEarningsGAAP"),
    )
    lines = filing_text.splitlines()

    def find_line(pattern: str, start: int = 0, end: int | None = None) -> int | None:
        stop = len(lines) if end is None else min(end, len(lines))
        for index in range(start, stop):
            normalized = re.sub(r"\s+", " ", lines[index]).strip()
            if re.match(pattern, normalized, flags=re.IGNORECASE):
                return index
        return None

    for segment, concept in source_segments:
        start = find_line(re.escape(segment) + r" Financial Results\s*$")
        if start is None:
            continue
        gaap_index = find_line(r"Earnings \(loss\) \(U\.S\. GAAP\)\s*$", start + 1, start + 18)
        if gaap_index is None:
            continue
        total_index = find_line(r"Total\s+", gaap_index + 1, gaap_index + 12)
        if total_index is None:
            continue
        amounts = _reported_amounts_after_label(lines[total_index], r"Total\s+")
        for offset, value in enumerate(amounts[:3]):
            append_fact(concept, f"{segment} segment earnings (U.S. GAAP), parent-company share", value,
                report_year - offset, "USD", "millions", f"SEC 10-K MD&A, {segment} Financial Results, U.S. GAAP earnings table")

    corporate_header = find_line(r"Corporate and Financing\s+20\d{2}\s+20\d{2}\s+20\d{2}\s*$")
    if corporate_header is not None:
        corporate_gaap = find_line(r"Earnings \(loss\) \(U\.S\. GAAP\)\s+", corporate_header + 1, corporate_header + 8)
        if corporate_gaap is not None:
            amounts = _reported_amounts_after_label(lines[corporate_gaap], r"Earnings \(loss\) \(U\.S\. GAAP\)\s+")
            for offset, value in enumerate(amounts[:3]):
                append_fact("EnergyCorporateFinancingEarningsGAAP", "Corporate and Financing earnings (U.S. GAAP)", value,
                    report_year - offset, "USD", "millions", "SEC 10-K Corporate and Financing earnings table, U.S. GAAP")

    weighted_share_pattern = r"Weighted-average number of common shares outstanding \(millions of shares\) \(1\)\s+"
    weighted_shares_index = find_line(weighted_share_pattern)
    if weighted_shares_index is not None:
        for offset, value in enumerate(_reported_amounts_after_label(lines[weighted_shares_index], weighted_share_pattern)[:3]):
            append_fact("EnergyWeightedAverageDilutedShares", "Weighted-average common shares outstanding (diluted)", value,
                report_year - offset, "shares", "millions", "SEC 10-K Note 2, weighted-average common shares outstanding")

    balance_sheet_index = find_line(r"CONSOLIDATED BALANCE SHEET\s*$")
    if balance_sheet_index is not None:
        current_debt_pattern = r"Notes and loans payable(?:\s+\d+)?\s+"
        long_term_debt_pattern = r"Long-term debt\s+\d+\s+"
        current_debt_index = find_line(current_debt_pattern, balance_sheet_index + 1, balance_sheet_index + 55)
        long_term_debt_index = find_line(long_term_debt_pattern, balance_sheet_index + 1, balance_sheet_index + 65)
        debt_components: dict[int, list[Dict[str, Any]]] = {}
        for concept, label, line_index, pattern in (
            ("EnergyCurrentDebt", "Current notes and loans payable", current_debt_index, current_debt_pattern),
            ("EnergyLongTermDebt", "Long-term debt", long_term_debt_index, long_term_debt_pattern),
        ):
            if line_index is None:
                continue
            for offset, value in enumerate(_reported_amounts_after_label(lines[line_index], pattern)[:2]):
                fact = append_fact(concept, label, value, report_year - offset, "USD", "millions",
                    "SEC 10-K consolidated balance sheet, interest-bearing debt line")
                debt_components.setdefault(report_year - offset, []).append(component_from(fact))
        for year, components in debt_components.items():
            if len(components) == 2:
                append_fact("EnergyInterestBearingDebt", "Total interest-bearing debt", sum(float(component["value"]) for component in components), year,
                    "USD", "millions", "Derived from SEC 10-K notes and loans payable plus long-term debt",
                    components=components)

    current_note_year = report_year
    for line in lines:
        normalized = re.sub(r"\s+", " ", line).strip()
        year_match = re.search(r"Year ended December 31,\s*(20\d{2})", normalized, flags=re.IGNORECASE)
        if year_match:
            current_note_year = int(year_match.group(1))
        interest_revenue_match = re.search(
            r"Corporate and Financing Interest revenue of\s+\$?\s*([\d,]+)\s+million",
            normalized,
            flags=re.IGNORECASE,
        )
        if interest_revenue_match:
            append_fact("EnergyCorporateInterestRevenue", "Corporate and Financing interest revenue", float(interest_revenue_match.group(1).replace(",", "")),
                current_note_year, "USD", "millions", "SEC 10-K Note 3 Corporate and Financing interest-revenue footnote")

    cash_capex_start = find_line(r"Cash Capital Expenditures\s*\(Non-GAAP\)")
    if cash_capex_start is not None:
        cash_capex_index = find_line(r"Total Cash Capex\s*\(Non-GAAP\)\s+", cash_capex_start + 1, cash_capex_start + 22)
        if cash_capex_index is not None:
            amounts = _reported_amounts_after_label(lines[cash_capex_index], r"Total Cash Capex\s*\(Non-GAAP\)\s+")
            for offset, value in enumerate(amounts[:3]):
                append_fact("EnergyCashCapex", "Total Cash Capex (Non-GAAP)", value, report_year - offset,
                    "USD", "millions", "SEC 10-K MD&A Cash Capital Expenditures reconciliation")

    component_patterns = (
        ("EnergyOperationalReceivablesCashImpact", "Notes and accounts receivable reduction/(increase)", r"Notes and accounts receivable reduction/\(increase\)\s+"),
        ("EnergyOperationalInventoryCashImpact", "Inventories reduction/(increase)", r"Inventories reduction/\(increase\)\s+"),
        ("EnergyOperationalOtherCurrentAssetsCashImpact", "Other current assets reduction/(increase)", r"Other current assets reduction/\(increase\)\s+"),
        ("EnergyOperationalPayablesCashImpact", "Accounts and other payables increase/(reduction)", r"Accounts and other payables increase/\(reduction\)\s+"),
    )
    components_by_year: dict[int, list[Dict[str, Any]]] = {}
    for concept, label, pattern in component_patterns:
        line_index = find_line(pattern)
        if line_index is None:
            continue
        for offset, value in enumerate(_reported_amounts_after_label(lines[line_index], pattern)[:3]):
            fact = append_fact(concept, label, value, report_year - offset, "USD", "millions",
                "SEC 10-K consolidated cash-flow statement, operational working-capital component")
            components_by_year.setdefault(report_year - offset, []).append(component_from(fact))
    for year, components in components_by_year.items():
        if len(components) == len(component_patterns):
            investment = -sum(float(component["value"]) for component in components)
            append_fact("EnergyWorkingCapitalInvestment", "Operating working-capital investment", investment, year,
                "USD", "millions", "Derived from SEC 10-K receivable, inventory, other-current-asset, and payable cash-flow impacts",
                components=components)

    sensitivity_lines = re.sub(r"\s+", " ", filing_text)
    for concept, label, pattern, unit, unit_scale in (
        ("Energy2026BrentEarningsSensitivity", "2026 Brent earnings sensitivity per $1/barrel", r"a \$1 per barrel change in the Brent price would have an approximately \$([\d,.]+) million annual after-tax effect", "USD", "millions per USD/barrel"),
        ("Energy2026HenryHubEarningsSensitivity", "2026 Henry Hub earnings sensitivity per $0.10/MMBtu", r"A \$0\.10 per million metric British thermal unit change in the Henry Hub price would have an approximately \$([\d,.]+) million annual after-tax effect", "USD", "millions per USD/MMBtu"),
        ("Energy2026TTFEarningsSensitivity", "2026 TTF earnings sensitivity per $0.10/MMBtu", r"A \$0\.10 per million metric British thermal unit change in the Title Transfer Facility \(TTF\) price would have an approximately \$([\d,.]+) million annual after-tax effect", "USD", "millions per USD/MMBtu"),
    ):
        match = re.search(pattern, sensitivity_lines, flags=re.IGNORECASE)
        if match:
            value = float(match.group(1).replace(",", ""))
            append_fact(concept, label, value, 2026, unit, unit_scale,
                "SEC 10-K Item 7A, issuer-provided 2026 after-tax earnings sensitivity; excludes derivatives where stated")

    segment_table_seen: set[tuple[int, str, str]] = set()
    segment_names = ("Upstream", "EnergyProducts", "ChemicalProducts", "SpecialtyProducts")
    for table in tables:
        table_text = " ".join(table.stripped_strings)
        has_segment_depreciation = (
            "Depreciation and depletion expense" in table_text
            or "Depreciation and depletion (includes impairments)" in table_text
        )
        has_segment_additions = re.search(r"Additions to property,\s*plant,?\s*and equipment", table_text) is not None
        if not has_segment_depreciation or not has_segment_additions:
            continue
        year: int | None = None
        for row in rows_for(table):
            label = row[0].strip()
            year_match = re.search(r"(?:Year ended|As of) December 31,\s*(20\d{2})", label, flags=re.I)
            if year_match:
                year = int(year_match.group(1))
                continue
            if year is None:
                continue
            if label.startswith(("Depreciation and depletion (includes impairments)", "Depreciation and depletion expense")):
                values = numbers(row[1:])
                if len(values) >= 9:
                    for index, segment in enumerate(segment_names):
                        value = values[index * 2] + values[index * 2 + 1]
                        key = (year, "depreciation", segment)
                        if key not in segment_table_seen:
                            append_fact(f"Energy{segment}DandD", f"{segment} segment depreciation and depletion; U.S. plus non-U.S.", value, year,
                                "USD", "millions", "SEC 10-K Note 3 segment table; U.S. and non-U.S. amounts summed")
                            segment_table_seen.add(key)
            if re.match(r"Additions to property,\s*plant,?\s*and equipment", label):
                values = numbers(row[1:])
                if len(values) >= 9:
                    for index, segment in enumerate(segment_names):
                        value = values[index * 2] + values[index * 2 + 1]
                        key = (year, "ppe_additions", segment)
                        if key not in segment_table_seen:
                            append_fact(f"Energy{segment}PPEAdditions", f"{segment} segment PP&E additions; U.S. plus non-U.S.", value, year,
                                "USD", "millions", "SEC 10-K Note 3 segment table; U.S. and non-U.S. amounts summed; includes non-cash additions where disclosed")
                            segment_table_seen.add(key)

    return sorted(output, key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))


async def _fetch_energy_filing_facts(
    company: Any,
    source_filings: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    filings_by_year: dict[int, Dict[str, Any]] = {}
    for filing in source_filings:
        if filing.get("form") not in {"10-K", "10-K/A"}:
            continue
        try:
            year = int(str(filing.get("report_date") or "")[:4])
        except (TypeError, ValueError):
            continue
        existing = filings_by_year.get(year)
        if existing is None or str(filing.get("filing_date") or "") > str(existing.get("filing_date") or ""):
            filings_by_year[year] = filing
    annual_filings = sorted(filings_by_year.values(), key=lambda row: str(row.get("filing_date") or ""), reverse=True)[:3]
    if not annual_filings:
        return []
    try:
        filings = await asyncio.to_thread(company.get_filings, form=["10-K", "10-K/A"])
    except Exception as exc:
        logger.warning("Energy SEC filings unavailable for %s (%s)", getattr(company, "cik", "unknown CIK"), type(exc).__name__)
        return []
    by_concept_period: dict[tuple[str, int], Dict[str, Any]] = {}
    for filing_record in annual_filings:
        accession = str(filing_record.get("accession_number") or "")
        if not accession:
            continue
        try:
            filing = await asyncio.to_thread(filings.get, accession)
            html = await asyncio.to_thread(_resilient_filing_html, filing)
            text = await asyncio.to_thread(_resilient_filing_text, filing)
        except Exception as exc:
            logger.warning("Energy 10-K extraction unavailable for %s (%s)", filing_record.get("report_date", "unknown period"), type(exc).__name__)
            continue
        parsed = _energy_filing_facts_from_html(
            html,
            text,
            report_date=str(filing_record.get("report_date") or ""),
            filing_date=str(filing_record.get("filing_date") or ""),
            accession_number=accession,
            form=str(filing_record.get("form") or "10-K"),
            primary_document=filing_record.get("primary_document"),
        )
        for fact in parsed:
            key = (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0))
            existing = by_concept_period.get(key)
            if existing is None or str(fact.get("filing_date") or "") > str(existing.get("filing_date") or ""):
                by_concept_period[key] = fact
    return sorted(by_concept_period.values(), key=lambda fact: (str(fact.get("concept") or ""), int(fact.get("fiscal_year") or 0)))

def _company_sic_code(company: Any) -> int:
    digits = re.sub(r"\D", "", str(getattr(company, "sic", "") or ""))
    return int(digits) if len(digits) == 4 else 0


def _is_energy_filer(company: Any) -> bool:
    code = _company_sic_code(company)
    return (1000 <= code <= 1499) or (2900 <= code <= 2999)


def _is_pharma_filer(company: Any) -> bool:
    return _company_sic_code(company) in {2833, 2834, 2835}


def _is_biotech_filer(company: Any) -> bool:
    return _company_sic_code(company) == 2836

@async_retry(retries=3)
async def fetch_company_financials_native(ticker: str, years: int = 5) -> Dict[str, Any]:
    normalized_ticker = (ticker or "").strip().upper()
    if not normalized_ticker:
        raise ResourceNotFound("Ticker is required")

    periods = max(1, min(int(years or 5), 10))
    cache_key = (normalized_ticker, periods)
    async with _FINANCIALS_INFLIGHT_LOCK:
        task = _FINANCIALS_INFLIGHT.get(cache_key)
        if task is None:
            task = asyncio.create_task(_fetch_company_financials_native(normalized_ticker, periods))
            _FINANCIALS_INFLIGHT[cache_key] = task
            task.add_done_callback(lambda finished: _clear_financials_inflight(cache_key, finished))
    return await asyncio.shield(task)


def _clear_financials_inflight(cache_key: tuple[str, int], task: asyncio.Task) -> None:
    if _FINANCIALS_INFLIGHT.get(cache_key) is task:
        _FINANCIALS_INFLIGHT.pop(cache_key, None)
    if not task.cancelled():
        task.exception()


async def _fetch_company_financials_native(normalized_ticker: str, periods: int) -> Dict[str, Any]:

    try:
        company = await _get_company(normalized_ticker)
    except Exception as exc:
        if _is_company_not_found_error(exc):
            raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database") from exc
        raise
    if company.cik < 0 or str(company.cik).startswith("-") or (company.name and company.name.startswith("Entity -")):
        raise ResourceNotFound(f"Company '{normalized_ticker}' not found in SEC database")

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

    async def _get_source_metadata_safe():
        try:
            return await asyncio.to_thread(_fetch_source_frames, company, periods + 3)
        except Exception:
            logger.warning("SEC source metadata unavailable for %s", normalized_ticker)
            return pd.DataFrame(), []

    income_df, balance_df, cashflow_df, key_metrics, is_fin, source_frames = await asyncio.gather(
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
        _get_source_metadata_safe(),
    )

    statements = {
        "income_statement": _records_from_statement(income_df, statement_type="IncomeStatement"),
        "balance_sheet": _records_from_statement(balance_df, statement_type="BalanceSheet"),
        "cashflow_statement": _records_from_statement(cashflow_df, statement_type="CashFlowStatement"),
    }
    source_filings = source_frames[1]
    source_facts = _source_facts_for_statements(source_frames[0], statements, source_filings, periods)
    if is_fin:
        bank_filing_facts, insurance_filing_facts, life_insurance_filing_facts = await _fetch_financial_institution_filing_facts(
            company, source_filings, normalized_ticker
        )
    else:
        bank_filing_facts, insurance_filing_facts, life_insurance_filing_facts = [], [], []
    asset_manager_facts = []
    if str(getattr(company, "sic", "")).strip() in {"6211", "6282"}:
        asset_manager_facts = await _fetch_asset_manager_filing_facts(company, source_filings)
    telecom_facts = []
    if str(getattr(company, "sic", "")).strip() == "4813":
        telecom_facts = await _fetch_telecom_filing_facts(company, source_filings)
    is_reit_filer = str(getattr(company, "sic", "")).strip() == "6798"
    reit_filing_facts = await _fetch_reit_filing_facts(company, source_filings) if is_reit_filer else []
    mortgage_reit_filing_facts = await _fetch_mortgage_reit_filing_facts(company, source_filings) if is_reit_filer else []
    energy_filing_facts = await _fetch_energy_filing_facts(company, source_filings) if _is_energy_filer(company) else []
    pharma_filing_facts = await _fetch_pharma_filing_facts(company, source_filings) if _is_pharma_filer(company) else []
    pipeline_assets = await _fetch_biotech_pipeline_assets(company, source_filings) if _is_biotech_filer(company) else []
    statement_years = [
        int(key[3:])
        for statement in statements.values()
        for row in statement
        for key in row
        if re.fullmatch(r"FY\s+20\d{2}", str(key))
    ]
    latest_statement_year = max(statement_years) if statement_years else None
    latest_year_key = f"FY {latest_statement_year}" if latest_statement_year else ""
    has_reported_interest_expense = bool(latest_year_key) and any(
        "interestexpense" in _normalized_concept(row.get("concept") or row.get("label"))
        and _finite_reported_number(row.get(latest_year_key)) is not None
        for row in statements["income_statement"]
    )
    has_reported_debt = bool(latest_year_key) and any(
        any(token in _normalized_concept(row.get("concept") or row.get("label")) for token in ("longtermdebt", "shorttermdebt", "commercialpaper", "borrowings"))
        and (_finite_reported_number(row.get(latest_year_key)) or 0) > 0
        for row in statements["balance_sheet"]
    )
    issuer_debt_cost_facts = []
    if not is_fin and not is_reit_filer and has_reported_debt and not has_reported_interest_expense:
        issuer_debt_cost_facts = await _fetch_issuer_debt_cost_facts(company, source_filings)

    return _sanitize_json_value(
        {
        "ticker": normalized_ticker,
        "cik": str(company.cik).zfill(10),
        "name": company.name or normalized_ticker,
        "source": "edgartools_native",
        "periods_requested": periods,
        "statements": statements,
        "source_filings": source_filings,
        "source_facts": source_facts,
        "bank_filing_facts": bank_filing_facts,
        "insurance_filing_facts": insurance_filing_facts,
        "life_insurance_filing_facts": life_insurance_filing_facts,
        "reit_filing_facts": reit_filing_facts,
        "mortgage_reit_filing_facts": mortgage_reit_filing_facts,
        "energy_filing_facts": energy_filing_facts,
        "pharma_filing_facts": pharma_filing_facts,
        "pipeline_assets": pipeline_assets,
        "asset_management_filing_facts": asset_manager_facts,
        "telecom_filing_facts": telecom_facts,
        "issuer_debt_cost_facts": issuer_debt_cost_facts,
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
