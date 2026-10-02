from __future__ import annotations

import math
import re
from typing import Any, Dict, Iterable, List

YEAR_RE = re.compile(r"(?:19|20)\d{2}")
PREFERRED_EQUITY_CONCEPTS = (
    "PreferredStockValue",
    "PreferredStockValueOutstanding",
    "PreferredStockIncludingAdditionalPaidInCapital",
    "PreferredStockIncludingAdditionalPaidInCapitalNetOfDiscount",
    "PreferredStockCarryingValue",
)


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _to_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def _positive(value: Any) -> float:
    parsed = _to_number(value)
    return parsed if parsed is not None and parsed > 0 else 0.0


def _years(rows: Iterable[Dict[str, Any]]) -> List[int]:
    years: set[int] = set()
    for row in rows:
        for key in row.keys():
            match = YEAR_RE.search(str(key))
            if match:
                years.add(int(match.group(0)))
    return sorted(years)


def _value_for_year(row: Dict[str, Any], year: int) -> float | None:
    selected_key = None
    for key in row.keys():
        match = YEAR_RE.search(str(key))
        if match and int(match.group(0)) == year:
            selected_key = key if selected_key is None or str(key) > str(selected_key) else selected_key
    return _to_number(row.get(selected_key)) if selected_key else None


def _line(
    value: float | None,
    *,
    source: str,
    confidence: float,
    method: str,
    concept: str | None = None,
    sources: list[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    return {
        "value": value,
        "source": source,
        "confidence": confidence,
        "method": method,
        "concept": concept,
        "sources": sources or [],
    }


def _source_record(row: Dict[str, Any], year: int) -> Dict[str, Any]:
    return {
        "concept": row.get("concept") or row.get("standard_concept"),
        "label": row.get("label"),
        "statement": row.get("statement"),
        "row_id": row.get("row_id"),
        "fiscal_period": f"FY {year}",
        "reported_value": _value_for_year(row, year),
        "accession": row.get("accession") or row.get("accession_number") or row.get("accn"),
        "filed": row.get("filed") or row.get("filed_date"),
        "form": row.get("form"),
        "report_date": row.get("report_date") or row.get("reportDate"),
        "currency": row.get("currency"),
        "unit": row.get("unit") or row.get("uom"),
        "unit_scale": row.get("unit_scale") or row.get("scale"),
    }


def _source_records(*lines: Dict[str, Any]) -> list[Dict[str, Any]]:
    return [source for line in lines for source in line.get("sources", [])]


def _prefer_reported_series(primary: List[Dict[str, Any]], fallback: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        fallback[idx] if primary[idx]["source"] == "missing" else primary[idx]
        for idx in range(min(len(primary), len(fallback)))
    ]


def _company_fact_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    fact_rows = native_financials.get("source_facts")
    fact_rows = fact_rows if isinstance(fact_rows, list) else []
    expected_key = _norm(expected_concept)
    series: List[Dict[str, Any]] = []
    for year in years:
        matches = []
        for fact in fact_rows:
            if not isinstance(fact, dict) or _norm(str(fact.get("concept") or "").split(":")[-1]) != expected_key:
                continue
            period_end = str(fact.get("period_end") or "")
            if not period_end.startswith(str(year)) or str(fact.get("fiscal_period") or "").upper() != "FY":
                continue
            value = _to_number(fact.get("value"))
            if value is not None:
                matches.append((fact, value))

        if not matches:
            series.append(_line(None, source="missing", confidence=0.0, method="missing_companyfact", concept=expected_concept))
            continue

        latest_source_year = max(int(fact.get("fiscal_year") or year) for fact, _value in matches)
        latest_matches = [
            (fact, value)
            for fact, value in matches
            if int(fact.get("fiscal_year") or year) == latest_source_year
        ]
        distinct_values = {value for _fact, value in latest_matches}
        if len(distinct_values) > 1:
            series.append(_line(
                None,
                source="ambiguous",
                confidence=0.0,
                method="ambiguous_companyfact_values",
                concept=expected_concept,
                sources=[{
                    "concept": fact.get("concept"),
                    "label": fact.get("label"),
                    "statement": "CompanyFacts",
                    "row_id": None,
                    "fiscal_period": f"FY {year}",
                    "reported_value": value,
                    "accession": fact.get("accession_number"),
                    "filed": fact.get("filing_date"),
                    "form": fact.get("form"),
                    "report_date": fact.get("report_date"),
                    "period_end": fact.get("period_end"),
                    "currency": fact.get("unit") if re.fullmatch(r"[A-Z]{3}", str(fact.get("unit") or "")) else None,
                    "unit": fact.get("unit"),
                    "unit_scale": "actual" if fact.get("unit") else None,
                    "source_fiscal_year": latest_source_year,
                } for fact, value in latest_matches],
            ))
            continue

        fact, value = latest_matches[0]
        unit = str(fact.get("unit") or "") or None
        series.append(_line(
            value,
            source="sec_native",
            confidence=0.95 if fact.get("accession_number") else 0.8,
            method="companyfacts_preferred_direct",
            concept=str(fact.get("concept") or expected_concept),
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": "CompanyFacts",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": value,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": unit if unit and re.fullmatch(r"[A-Z]{3}", unit) else None,
                "unit": unit,
                "unit_scale": "actual" if unit else None,
                "source_fiscal_year": latest_source_year,
            }],
        ))
    return series


def _bank_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("bank_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    scale_factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_bank_table_line", concept=expected_concept))
            continue

        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed_matches: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest_matches:
            raw_value = _to_number(fact.get("value"))
            unit_scale = str(fact.get("unit_scale") or "").lower()
            factor = scale_factors.get(unit_scale)
            if raw_value is not None and factor is not None and str(fact.get("unit") or "").upper() == "USD":
                parsed_matches.append((fact, raw_value, raw_value * factor))
        distinct_values = {value for _fact, _raw, value in parsed_matches}
        if len(distinct_values) > 1:
            result.append(_line(
                None,
                source="ambiguous",
                confidence=0.0,
                method="conflicting_filed_bank_table_values",
                concept=expected_concept,
                sources=[{
                    "concept": fact.get("concept"),
                    "label": fact.get("label"),
                    "statement": fact.get("source_statement") or "SEC 10-K table",
                    "row_id": None,
                    "fiscal_period": f"FY {year}",
                    "reported_value": raw_value,
                    "accession": fact.get("accession_number"),
                    "filed": fact.get("filing_date"),
                    "form": fact.get("form"),
                    "report_date": fact.get("report_date"),
                    "period_end": fact.get("period_end"),
                    "currency": "USD",
                    "unit": "USD",
                    "unit_scale": fact.get("unit_scale"),
                    "source_fiscal_year": fact.get("fiscal_year"),
                } for fact, raw_value, _normalized in parsed_matches],
            ))
            continue
        if not parsed_matches:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_bank_table_line", concept=expected_concept))
            continue

        fact, raw_value, normalized_value = parsed_matches[0]
        result.append(_line(
            normalized_value,
            source="sec_native",
            confidence=0.95 if fact.get("accession_number") else 0.8,
            method="filed_10k_bank_table_value_normalized_to_usd",
            concept=expected_concept,
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": raw_value,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": "USD",
                "unit": "USD",
                "unit_scale": fact.get("unit_scale"),
                "source_fiscal_year": fact.get("fiscal_year"),
            }],
        ))
    return result


def _bank_ratio_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("bank_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and str(fact.get("period_end") or "").startswith(str(year))
            and str(fact.get("unit") or "").lower() == "percent"
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_bank_ratio", concept=expected_concept))
            continue
        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed = [(fact, _to_number(fact.get("value"))) for fact in latest_matches]
        parsed = [(fact, value) for fact, value in parsed if value is not None and 0 < value < 100]
        distinct = {value for _fact, value in parsed}
        if len(distinct) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_bank_ratios", concept=expected_concept))
            continue
        if not parsed:
            result.append(_line(None, source="missing", confidence=0.0, method="invalid_filed_bank_ratio", concept=expected_concept))
            continue
        fact, reported_percent = parsed[0]
        result.append(_line(
            reported_percent / 100.0,
            source="sec_native",
            confidence=0.95 if fact.get("accession_number") else 0.8,
            method="filed_10k_cet1_requirement_percent_normalized_to_ratio",
            concept=expected_concept,
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K regulatory capital table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": reported_percent,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": None,
                "unit": "percent",
                "unit_scale": "percent",
                "source_fiscal_year": fact.get("fiscal_year"),
            }],
        ))
    return result


def _insurance_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
    *,
    is_ratio: bool = False,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("insurance_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    scale_factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_insurance_table_line", concept=expected_concept))
            continue
        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed_matches: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest_matches:
            raw_value = _to_number(fact.get("value"))
            unit_scale = str(fact.get("unit_scale") or "").lower()
            if raw_value is None:
                continue
            if is_ratio and str(fact.get("unit") or "").lower() == "percent" and unit_scale == "percent" and 0 <= raw_value < 100:
                parsed_matches.append((fact, raw_value, raw_value / 100.0))
            elif not is_ratio and str(fact.get("unit") or "").upper() == "USD" and unit_scale in scale_factors:
                parsed_matches.append((fact, raw_value, raw_value * scale_factors[unit_scale]))

        distinct_values = {value for _fact, _raw, value in parsed_matches}
        if len(distinct_values) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_insurance_table_values", concept=expected_concept))
            continue
        if not parsed_matches:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_insurance_table_line", concept=expected_concept))
            continue
        fact, raw_value, normalized_value = parsed_matches[0]
        result.append(_line(
            normalized_value,
            source="sec_native",
            confidence=0.95 if fact.get("accession_number") else 0.8,
            method="filed_10k_insurance_table_value_normalized",
            concept=expected_concept,
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K insurance table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": raw_value,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": None if is_ratio else "USD",
                "unit": "percent" if is_ratio else "USD",
                "unit_scale": "percent" if is_ratio else fact.get("unit_scale"),
                "source_fiscal_year": fact.get("fiscal_year"),
            }],
        ))
    return result


def _asset_manager_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("asset_management_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    scale_factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and _to_number(fact.get("fiscal_year")) == year
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_asset_manager_table_line", concept=expected_concept))
            continue

        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed_matches: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest_matches:
            raw_value = _to_number(fact.get("value"))
            unit_scale = str(fact.get("unit_scale") or "").lower()
            factor = scale_factors.get(unit_scale)
            if raw_value is None or factor is None or str(fact.get("unit") or "").upper() != "USD":
                continue
            parsed_matches.append((fact, raw_value, raw_value * factor))

        distinct_values = {value for _fact, _raw_value, value in parsed_matches}
        if len(distinct_values) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_asset_manager_table_values", concept=expected_concept))
            continue
        if not parsed_matches:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_asset_manager_table_line", concept=expected_concept))
            continue

        fact, raw_value, normalized_value = parsed_matches[0]
        source_statement = str(fact.get("source_statement") or "SEC 10-K asset-manager table")
        is_derived = "derived as" in source_statement.lower()
        source = "derived" if is_derived else "sec_native"
        source_records = [{
            "concept": fact.get("concept"),
            "label": fact.get("label"),
            "statement": source_statement,
            "row_id": None,
            "fiscal_period": f"FY {year}",
            "reported_value": raw_value,
            "accession": fact.get("accession_number"),
            "filed": fact.get("filing_date"),
            "form": fact.get("form"),
            "report_date": fact.get("report_date"),
            "period_end": fact.get("period_end"),
            "currency": "USD",
            "unit": "USD",
            "unit_scale": fact.get("unit_scale"),
            "source_fiscal_year": fact.get("fiscal_year"),
        }]
        fact_components = fact.get("source_components")
        if isinstance(fact_components, list):
            for component in fact_components:
                if not isinstance(component, dict):
                    continue
                source_records.append({
                    "concept": component.get("concept"),
                    "label": component.get("label"),
                    "statement": component.get("source_statement"),
                    "row_id": None,
                    "fiscal_period": f"FY {component.get('fiscal_year')}",
                    "reported_value": _to_number(component.get("value")),
                    "accession": component.get("accession_number"),
                    "filed": component.get("filing_date"),
                    "form": component.get("form"),
                    "report_date": component.get("report_date"),
                    "period_end": component.get("period_end"),
                    "currency": "USD",
                    "unit": component.get("unit") or "USD",
                    "unit_scale": component.get("unit_scale"),
                    "source_fiscal_year": component.get("fiscal_year"),
                })
        derived_method = (
            "derived_from_filed_aum_change" if expected_concept == "AssetManagerAum"
            else "derived_from_filed_aum_rollforward" if expected_concept == "AssetManagerScopeChange"
            else "negative_of_filed_operating_cashflow_asset_liability_changes" if expected_concept == "AssetManagerWorkingCapitalChange"
            else "derived_from_filed_asset_manager_disclosure"
        )
        result.append(_line(
            normalized_value,
            source=source,
            confidence=0.90 if is_derived else 0.95,
            method=derived_method if is_derived else "filed_10k_asset_manager_table_value_normalized",
            concept=expected_concept,
            sources=source_records,
        ))
    return result


def _telecom_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("telecom_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    scale_factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and _to_number(fact.get("fiscal_year")) == year
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_telecom_table_line", concept=expected_concept))
            continue

        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed_matches: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest_matches:
            raw_value = _to_number(fact.get("value"))
            unit = str(fact.get("unit") or "").lower()
            unit_scale = str(fact.get("unit_scale") or "").lower()
            if raw_value is None:
                continue
            if unit == "usd" and unit_scale in scale_factors:
                parsed_matches.append((fact, raw_value, raw_value * scale_factors[unit_scale]))
            elif unit == "subscribers" and unit_scale == "thousands":
                parsed_matches.append((fact, raw_value, raw_value * 1_000.0))
            elif unit == "percent" and unit_scale in {"monthly", "annual"}:
                parsed_matches.append((fact, raw_value, raw_value / 100.0))

        distinct_values = {value for _fact, _raw_value, value in parsed_matches}
        if len(distinct_values) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_telecom_table_values", concept=expected_concept))
            continue
        if not parsed_matches:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_telecom_table_line", concept=expected_concept))
            continue

        fact, raw_value, normalized_value = parsed_matches[0]
        unit = str(fact.get("unit") or "")
        unit_scale = str(fact.get("unit_scale") or "")
        source_records = [{
            "concept": fact.get("concept"),
            "label": fact.get("label"),
            "statement": fact.get("source_statement") or "SEC 10-K telecom operating table",
            "row_id": None,
            "fiscal_period": f"FY {year}",
            "reported_value": raw_value,
            "accession": fact.get("accession_number"),
            "filed": fact.get("filing_date"),
            "form": fact.get("form"),
            "report_date": fact.get("report_date"),
            "period_end": fact.get("period_end"),
            "currency": "USD" if unit.lower() == "usd" else None,
            "unit": unit,
            "unit_scale": unit_scale,
            "source_fiscal_year": fact.get("fiscal_year"),
        }]
        components = fact.get("source_components")
        if isinstance(components, list):
            for component in components:
                if not isinstance(component, dict):
                    continue
                source_records.append({
                    "concept": component.get("concept"),
                    "label": component.get("label"),
                    "statement": component.get("source_statement"),
                    "row_id": None,
                    "fiscal_period": f"FY {component.get('fiscal_year')}",
                    "reported_value": _to_number(component.get("value")),
                    "accession": component.get("accession_number"),
                    "filed": component.get("filing_date"),
                    "form": component.get("form"),
                    "report_date": component.get("report_date"),
                    "period_end": component.get("period_end"),
                    "currency": "USD" if str(component.get("unit") or "").upper() == "USD" else None,
                    "unit": component.get("unit"),
                    "unit_scale": component.get("unit_scale"),
                    "source_fiscal_year": component.get("fiscal_year"),
                })
        derived_methods = {
            "TelecomCapitalExpenditures": "filed_capex_cashflow_outflow_normalized_to_positive_investment",
            "TelecomWorkingCapitalChange": "derived_from_filed_operating_asset_and_liability_cash_impacts",
        }
        is_derived = expected_concept in derived_methods
        result.append(_line(
            normalized_value,
            source="derived" if is_derived else "sec_native",
            confidence=0.95,
            method=derived_methods.get(expected_concept, "filed_10k_telecom_table_value_normalized"),
            concept=expected_concept,
            sources=source_records,
        ))
    return result


def _mortgage_reit_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("mortgage_reit_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and _to_number(fact.get("fiscal_year")) == year
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_mortgage_reit_table_line", concept=expected_concept))
            continue
        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest:
            raw = _to_number(fact.get("value"))
            unit = str(fact.get("unit") or "").lower()
            unit_scale = str(fact.get("unit_scale") or "").lower()
            if raw is None:
                continue
            if unit == "usd" and unit_scale in factors:
                parsed.append((fact, raw, raw * factors[unit_scale]))
            elif unit == "shares" and unit_scale in factors:
                parsed.append((fact, raw, raw * factors[unit_scale]))
            elif unit == "usd per share" and unit_scale == "actual":
                parsed.append((fact, raw, raw))
            elif unit == "percent" and unit_scale == "annual":
                parsed.append((fact, raw, raw / 100.0))
            elif unit == "multiple" and unit_scale == "times":
                parsed.append((fact, raw, raw))
        unique_values = {value for _fact, _raw, value in parsed}
        if len(unique_values) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_mortgage_reit_values", concept=expected_concept))
            continue
        if not parsed:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_mortgage_reit_table_line", concept=expected_concept))
            continue
        fact, raw, normalized = parsed[0]
        unit = str(fact.get("unit") or "")
        result.append(_line(
            normalized,
            source="sec_native",
            confidence=0.95,
            method="filed_10k_mortgage_reit_table_value_normalized",
            concept=expected_concept,
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K mortgage REIT table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": raw,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": "USD" if unit.lower() == "usd" else None,
                "unit": unit,
                "unit_scale": fact.get("unit_scale"),
                "source_fiscal_year": fact.get("fiscal_year"),
            }],
        ))
    return result


def _energy_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("energy_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    amount_scales = {
        "actual": 1.0,
        "thousands": 1_000.0,
        "millions": 1_000_000.0,
        "billions": 1_000_000_000.0,
        "millions per usd/barrel": 1_000_000.0,
        "millions per usd/mmbtu": 1_000_000.0,
    }
    unit_factors = {
        "usd": amount_scales,
        "shares": amount_scales,
        "barrels per day": amount_scales,
        "cubic feet per day": amount_scales,
        "barrels of oil equivalent per day": amount_scales,
        "barrels of oil equivalent": amount_scales,
        "usd per barrel": {"actual": 1.0},
        "usd per thousand cubic feet": {"actual": 1.0},
        "usd per barrel of oil equivalent": {"actual": 1.0},
    }
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and _to_number(fact.get("fiscal_year")) == year
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_energy_table_line", concept=expected_concept))
            continue
        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        parsed: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest:
            raw = _to_number(fact.get("value"))
            unit = str(fact.get("unit") or "").strip().lower()
            scale = str(fact.get("unit_scale") or "").strip().lower()
            factor = unit_factors.get(unit, {}).get(scale)
            if raw is not None and factor is not None:
                parsed.append((fact, raw, raw * factor))
        unique = {normalized for _fact, _raw, normalized in parsed}
        if len(unique) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_energy_values", concept=expected_concept))
            continue
        if not parsed:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_energy_table_line", concept=expected_concept))
            continue
        fact, raw, normalized = parsed[0]
        unit = str(fact.get("unit") or "")
        source_records: list[Dict[str, Any]] = []
        components = fact.get("source_components")
        if isinstance(components, list) and components:
            for component in components:
                if not isinstance(component, dict):
                    continue
                source_records.append({
                    "concept": component.get("concept"),
                    "label": component.get("label"),
                    "statement": component.get("source_statement"),
                    "row_id": None,
                    "fiscal_period": f"FY {component.get('fiscal_year')}",
                    "reported_value": _to_number(component.get("value")),
                    "accession": component.get("accession_number"),
                    "filed": component.get("filing_date"),
                    "form": component.get("form"),
                    "report_date": component.get("report_date"),
                    "period_end": component.get("period_end"),
                    "currency": "USD" if str(component.get("unit") or "").lower() == "usd" else None,
                    "unit": component.get("unit"),
                    "unit_scale": component.get("unit_scale"),
                    "source_fiscal_year": component.get("fiscal_year"),
                })
        else:
            source_records.append({
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K energy table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": raw,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": "USD" if unit.lower() == "usd" or unit.lower().startswith("usd ") else None,
                "unit": unit,
                "unit_scale": fact.get("unit_scale"),
                "source_fiscal_year": fact.get("fiscal_year"),
            })
        is_derived = bool(components)
        result.append(_line(
            normalized,
            source="derived" if is_derived else "sec_native",
            confidence=0.93 if is_derived else 0.96,
            method="derived_from_filed_energy_components" if is_derived else "filed_xom_10k_energy_table_value_normalized",
            concept=expected_concept,
            sources=source_records,
        ))
    return result


def _pharma_filing_line(fact: Dict[str, Any]) -> Dict[str, Any]:
    raw = _to_number(fact.get("value"))
    metric = str(fact.get("metric") or "")
    unit = str(fact.get("unit") or "").strip().lower()
    scale = str(fact.get("unit_scale") or "").strip().lower()
    factor = 1_000_000.0 if unit == "usd" and scale == "millions" else 1.0 if unit == "calendar year" and scale == "actual" else None
    concept = metric
    if raw is None or factor is None:
        return _line(None, source="missing", confidence=0.0, method="unscaled_pfe_10k_product_or_patent_fact", concept=concept)
    year = int(_to_number(fact.get("fiscal_year")) or 0)
    return _line(
        raw * factor,
        source="sec_native",
        confidence=0.96,
        method="filed_pfe_10k_product_or_patent_table_value_normalized",
        concept=concept,
        sources=[{
            "concept": metric,
            "label": fact.get("product_name"),
            "statement": fact.get("source_statement") or "SEC 10-K product or patent table",
            "row_id": None,
            "fiscal_period": f"FY {year}",
            "reported_value": raw,
            "accession": fact.get("accession_number"),
            "filed": fact.get("filing_date"),
            "form": fact.get("form"),
            "report_date": fact.get("report_date"),
            "period_end": fact.get("period_end"),
            "currency": "USD" if unit == "usd" else None,
            "unit": fact.get("unit"),
            "unit_scale": fact.get("unit_scale"),
            "source_fiscal_year": year,
        }],
    )


def _asset_manager_beginning_aum_series(
    native_financials: Dict[str, Any],
    years: List[int],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for year in years:
        beginning_aum = _asset_manager_filing_series(native_financials, [year - 1], "AssetManagerAum")[0]
        if beginning_aum.get("source") not in {"sec_native", "derived"} or _to_number(beginning_aum.get("value")) is None:
            result.append(_line(
                None,
                source="missing",
                confidence=0.0,
                method=f"missing_filed_beginning_aum_fy{year}",
                concept="asset_manager_beginning_aum",
            ))
            continue
        result.append(_line(
            _to_number(beginning_aum.get("value")),
            source=beginning_aum.get("source") or "missing",
            confidence=float(beginning_aum.get("confidence") or 0),
            method="opening_balance_from_filed_asset_manager_aum_history",
            concept="asset_manager_beginning_aum",
            sources=list(beginning_aum.get("sources") or []),
        ))
    return result


def _asset_manager_average_aum_series(
    years: List[int],
    beginning_aum: List[Dict[str, Any]],
    ending_aum: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        beginning_line = beginning_aum[idx]
        ending_line = ending_aum[idx]
        beginning_value = _to_number(beginning_line.get("value"))
        ending_value = _to_number(ending_line.get("value"))
        if (
            beginning_value is None
            or ending_value is None
            or beginning_value <= 0
            or ending_value <= 0
            or beginning_line.get("source") not in {"sec_native", "derived"}
            or ending_line.get("source") not in {"sec_native", "derived"}
        ):
            result.append(_line(
                None,
                source="missing",
                confidence=0.0,
                method=f"missing_filed_beginning_or_ending_aum_fy{year}",
                concept="asset_manager_average_aum",
            ))
            continue
        result.append(_line(
            (beginning_value + ending_value) / 2,
            source="derived",
            confidence=min(float(beginning_line.get("confidence") or 0), float(ending_line.get("confidence") or 0)),
            method="average_of_beginning_and_ending_filed_aum",
            concept="asset_manager_average_aum",
            sources=_source_records(beginning_line, ending_line),
        ))
    return result


def _asset_manager_base_fee_yield_series(
    base_fees: List[Dict[str, Any]],
    average_aum: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for fee_line, aum_line in zip(base_fees, average_aum):
        fee_value = _to_number(fee_line.get("value"))
        average_aum_value = _to_number(aum_line.get("value"))
        if (
            fee_value is None
            or fee_value < 0
            or average_aum_value is None
            or average_aum_value <= 0
            or fee_line.get("source") not in {"sec_native", "derived"}
            or aum_line.get("source") != "derived"
        ):
            result.append(_line(
                None,
                source="missing",
                confidence=0.0,
                method="missing_filed_base_fees_or_average_aum",
                concept="asset_manager_base_fee_yield",
            ))
            continue
        result.append(_line(
            fee_value / average_aum_value,
            source="derived",
            confidence=min(float(fee_line.get("confidence") or 0), float(aum_line.get("confidence") or 0)),
            method="base_advisory_fees_divided_by_average_aum",
            concept="asset_manager_base_fee_yield",
            sources=_source_records(fee_line, aum_line),
        ))
    return result


def _asset_manager_unmapped_revenue_series(
    revenue: List[Dict[str, Any]],
    components: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for idx, revenue_line in enumerate(revenue):
        revenue_value = _to_number(revenue_line.get("value"))
        if revenue_value is None or revenue_line.get("source") not in {"sec_native", "derived"}:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_consolidated_revenue", concept="asset_manager_unmapped_revenue"))
            continue
        mapped_lines: list[Dict[str, Any]] = []
        ambiguous = False
        for series in components.values():
            line = series[idx]
            if line.get("source") == "ambiguous":
                ambiguous = True
            elif line.get("source") in {"sec_native", "derived"} and _to_number(line.get("value")) is not None:
                mapped_lines.append(line)
        if ambiguous:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_filed_asset_manager_fee_revenue_components", concept="asset_manager_unmapped_revenue", sources=_source_records(revenue_line, *mapped_lines)))
            continue
        residual = revenue_value - sum(float(line["value"]) for line in mapped_lines)
        tolerance = max(1.0, abs(revenue_value) * 1e-9)
        if residual < -tolerance:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="mapped_asset_manager_fee_revenue_exceeds_consolidated_revenue", concept="asset_manager_unmapped_revenue", sources=_source_records(revenue_line, *mapped_lines)))
            continue
        if abs(residual) <= tolerance:
            residual = 0.0
        result.append(_line(
            residual,
            source="derived",
            confidence=min([float(revenue_line.get("confidence") or 0), *[float(line.get("confidence") or 0) for line in mapped_lines]]),
            method="consolidated_revenue_less_separately_mapped_asset_manager_fee_components",
            concept="asset_manager_unmapped_revenue",
            sources=_source_records(revenue_line, *mapped_lines),
        ))
    return result


def _reit_filing_series(
    native_financials: Dict[str, Any],
    years: List[int],
    expected_concept: str,
    *,
    is_ratio: bool = False,
) -> List[Dict[str, Any]]:
    facts = native_financials.get("reit_filing_facts")
    facts = facts if isinstance(facts, list) else []
    expected_key = _norm(expected_concept)
    scale_factors = {"actual": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0, "billions": 1_000_000_000.0}
    result: List[Dict[str, Any]] = []
    for year in years:
        matches = [
            fact for fact in facts
            if isinstance(fact, dict)
            and _norm(fact.get("concept")) == expected_key
            and str(fact.get("fiscal_period") or "").upper() == "FY"
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        if not matches:
            result.append(_line(None, source="missing", confidence=0.0, method="missing_filed_reit_table_line", concept=expected_concept))
            continue
        latest_filed = max(str(fact.get("filing_date") or "") for fact in matches)
        latest_matches = [fact for fact in matches if str(fact.get("filing_date") or "") == latest_filed]
        normalized: list[tuple[Dict[str, Any], float, float]] = []
        for fact in latest_matches:
            raw_value = _to_number(fact.get("value"))
            unit = str(fact.get("unit") or "").lower()
            scale = str(fact.get("unit_scale") or "").lower()
            if raw_value is None:
                continue
            if is_ratio and unit == "percent" and scale == "percent" and 0 <= raw_value <= 100:
                normalized.append((fact, raw_value, raw_value / 100.0))
            elif not is_ratio and unit == "usd" and scale in scale_factors:
                normalized.append((fact, raw_value, raw_value * scale_factors[scale]))
        distinct = {value for _fact, _raw, value in normalized}
        if len(distinct) > 1:
            result.append(_line(None, source="ambiguous", confidence=0.0, method="conflicting_filed_reit_table_values", concept=expected_concept))
            continue
        if not normalized:
            result.append(_line(None, source="missing", confidence=0.0, method="unscaled_filed_reit_table_line", concept=expected_concept))
            continue
        fact, raw_value, normalized_value = normalized[0]
        result.append(_line(
            normalized_value,
            source="sec_native",
            confidence=0.95 if fact.get("accession_number") and fact.get("filing_date") else 0.8,
            method="filed_10k_reit_table_value_normalized",
            concept=expected_concept,
            sources=[{
                "concept": fact.get("concept"),
                "label": fact.get("label"),
                "statement": fact.get("source_statement") or "SEC 10-K REIT table",
                "row_id": None,
                "fiscal_period": f"FY {year}",
                "reported_value": raw_value,
                "accession": fact.get("accession_number"),
                "filed": fact.get("filing_date"),
                "form": fact.get("form"),
                "report_date": fact.get("report_date"),
                "period_end": fact.get("period_end"),
                "currency": None if is_ratio else "USD",
                "unit": "percent" if is_ratio else "USD",
                "unit_scale": "percent" if is_ratio else fact.get("unit_scale"),
                "source_fiscal_year": fact.get("fiscal_year"),
            }],
        ))
    return result


def _sum_lines(left: Dict[str, Any], right: Dict[str, Any], *, method: str, concept: str) -> Dict[str, Any]:
    if left["source"] == "ambiguous" or right["source"] == "ambiguous":
        return _line(None, source="ambiguous", confidence=0.0, method=f"ambiguous_{method}", concept=concept, sources=_source_records(left, right))
    if left["value"] is None or right["value"] is None:
        return _line(None, source="missing", confidence=0.0, method=f"missing_{method}_inputs", concept=concept, sources=_source_records(left, right))
    return _line(
        left["value"] + right["value"],
        source="derived",
        confidence=min(left["confidence"], right["confidence"]),
        method=method,
        concept=concept,
        sources=_source_records(left, right),
    )


def _sum_many_lines(lines: list[Dict[str, Any]], *, method: str, concept: str) -> Dict[str, Any]:
    if any(line["source"] == "ambiguous" for line in lines):
        return _line(None, source="ambiguous", confidence=0.0, method=f"ambiguous_{method}", concept=concept, sources=_source_records(*lines))
    if not lines or any(line["value"] is None for line in lines):
        return _line(None, source="missing", confidence=0.0, method=f"missing_{method}_inputs", concept=concept, sources=_source_records(*lines))
    return _line(
        sum(float(line["value"]) for line in lines),
        source="derived",
        confidence=min(float(line["confidence"]) for line in lines),
        method=method,
        concept=concept,
        sources=_source_records(*lines),
    )


def _difference_line(left: Dict[str, Any], right: Dict[str, Any], *, method: str, concept: str) -> Dict[str, Any]:
    if left["source"] == "ambiguous" or right["source"] == "ambiguous":
        return _line(None, source="ambiguous", confidence=0.0, method=f"ambiguous_{method}", concept=concept, sources=_source_records(left, right))
    if left["value"] is None or right["value"] is None:
        return _line(None, source="missing", confidence=0.0, method=f"missing_{method}_inputs", concept=concept, sources=_source_records(left, right))
    return _line(
        float(left["value"]) - float(right["value"]),
        source="derived",
        confidence=min(float(left["confidence"]), float(right["confidence"])),
        method=method,
        concept=concept,
        sources=_source_records(left, right),
    )


def _is_parent_equity(line: Dict[str, Any]) -> bool:
    if "parent" in _norm(line.get("concept")) or "attributabletoparent" in _norm(line.get("concept")):
        return True
    return any(
        "parent" in _norm(source.get("label")) or "attributabletoparent" in _norm(source.get("concept"))
        for source in line.get("sources", [])
        if isinstance(source, dict)
    )


def _common_equity_line(
    book_line: Dict[str, Any],
    preferred_line: Dict[str, Any],
    nci_line: Dict[str, Any],
) -> Dict[str, Any]:
    if book_line["source"] == "ambiguous" or preferred_line["source"] == "ambiguous" or nci_line["source"] == "ambiguous":
        return _line(None, source="ambiguous", confidence=0.0, method="ambiguous_common_equity_inputs", concept="parent_common_equity", sources=_source_records(book_line, preferred_line, nci_line))
    preferred_value = 0.0 if preferred_line["source"] == "not_applicable" else preferred_line["value"]
    if book_line["value"] is None or preferred_value is None:
        return _line(None, source="missing", confidence=0.0, method="incomplete_common_equity_inputs", concept="parent_common_equity", sources=_source_records(book_line, preferred_line))

    if _is_parent_equity(book_line):
        return _line(
            book_line["value"] - preferred_value,
            source="derived",
            confidence=min(book_line["confidence"], preferred_line["confidence"]),
            method="parent_attributable_equity_less_preferred_stock",
            concept="parent_common_equity",
            sources=_source_records(book_line, preferred_line),
        )

    nci_value = 0.0 if nci_line["source"] == "not_applicable" else nci_line["value"]
    if nci_value is None:
        return _line(None, source="missing", confidence=0.0, method="missing_noncontrolling_interest_for_common_equity", concept="parent_common_equity", sources=_source_records(book_line, preferred_line, nci_line))
    return _line(
        book_line["value"] - preferred_value - nci_value,
        source="derived",
        confidence=min(book_line["confidence"], preferred_line["confidence"], nci_line["confidence"]),
        method="total_equity_less_preferred_stock_and_noncontrolling_interest",
        concept="parent_common_equity",
        sources=_source_records(book_line, preferred_line, nci_line),
    )


def _attach_sec_fact_metadata(line: Dict[str, Any], year: int, source_facts: List[Dict[str, Any]]) -> None:
    for source in line.get("sources", []):
        concept = _norm(str(source.get("concept") or "").split(":")[-1])
        reported_value = source.get("reported_value")
        candidates: list[Dict[str, Any]] = []
        for fact in source_facts:
            fact_concept = _norm(str(fact.get("concept") or "").split(":")[-1])
            period_end = str(fact.get("period_end") or "")
            if fact_concept != concept or not period_end.startswith(str(year)):
                continue
            try:
                fact_value = float(fact.get("value"))
                row_value = float(reported_value)
            except (TypeError, ValueError):
                continue
            if math.isclose(fact_value, row_value, rel_tol=1e-10, abs_tol=0.01):
                candidates.append(fact)

        if not candidates:
            source.setdefault("accession", None)
            source.setdefault("filed", None)
            source.setdefault("form", None)
            source.setdefault("report_date", None)
            source.setdefault("currency", None)
            source.setdefault("unit", None)
            source.setdefault("unit_scale", None)
            continue

        candidates.sort(
            key=lambda fact: (
                int(fact.get("fiscal_year") or year),
                str(fact.get("filing_date") or ""),
            ),
            reverse=True,
        )
        fact = candidates[0]
        unit = str(fact.get("unit") or "") or None
        source.update({
            "accession": fact.get("accession_number"),
            "filed": fact.get("filing_date"),
            "form": fact.get("form"),
            "report_date": fact.get("report_date"),
            "period_end": fact.get("period_end"),
            "currency": unit if unit and re.fullmatch(r"[A-Z]{3}", unit) else None,
            "unit": unit,
            "unit_scale": "actual" if unit else None,
            "source_fiscal_year": fact.get("fiscal_year"),
        })


def _attach_period_filing_metadata(
    line: Dict[str, Any],
    year: int,
    source_filings: List[Dict[str, Any]],
    currency: str | None,
) -> None:
    if str(currency or "").upper() != "USD":
        return
    for source in line.get("sources", []):
        if source.get("accession") or source.get("statement") not in {
            "IncomeStatement", "BalanceSheet", "CashFlowStatement",
        }:
            continue
        candidates = [
            filing for filing in source_filings
            if isinstance(filing, dict)
            and str(filing.get("report_date") or "").startswith(str(year))
            and str(filing.get("form") or "") in {"10-K", "10-K/A"}
        ]
        if not candidates:
            continue
        filing = max(candidates, key=lambda item: str(item.get("filing_date") or ""))
        source.update({
            "accession": filing.get("accession_number"),
            "filed": filing.get("filing_date"),
            "form": filing.get("form"),
            "report_date": filing.get("report_date"),
            "period_end": filing.get("report_date"),
            "currency": "USD",
            "unit": "USD",
            "unit_scale": "actual",
            "source_fiscal_year": year,
        })


def _row_key(row: Dict[str, Any]) -> str:
    return " ".join(
        _norm(row.get(key))
        for key in ("standard_concept", "concept", "label")
    )


def _find_rows(rows: List[Dict[str, Any]], *needles: str, exact: bool = False, exclude: tuple[str, ...] = ()) -> List[Dict[str, Any]]:
    normalized_needles = tuple(_norm(needle) for needle in needles)
    normalized_exclude = tuple(_norm(item) for item in exclude)
    matched: List[Dict[str, Any]] = []
    for row in rows:
        key = _row_key(row)
        if any(item and item in key for item in normalized_exclude):
            continue
        parts = {_norm(row.get("standard_concept")), _norm(row.get("concept")), _norm(row.get("label"))}
        if exact:
            if any(needle in parts for needle in normalized_needles):
                matched.append(row)
        elif any(needle and needle in key for needle in normalized_needles):
            matched.append(row)
    return matched


def _pick_series(
    rows: List[Dict[str, Any]],
    years: List[int],
    *needles: str,
    exact: bool = False,
    exclude: tuple[str, ...] = (),
    preferred: tuple[str, ...] = (),
    strict: bool = False,
) -> List[Dict[str, Any]]:
    matches = _find_rows(rows, *needles, exact=exact, exclude=exclude)
    series: List[Dict[str, Any]] = []
    preferred_keys = tuple(_norm(item) for item in preferred)
    for year in years:
        candidates = []
        for row in matches:
            year_keys = [
                key for key, value in row.items()
                if YEAR_RE.search(str(key))
                and int(YEAR_RE.search(str(key)).group()) == year
                and value is not None
            ]
            if not year_keys:
                continue
            value = _value_for_year(row, year)
            if value is None:
                continue
            parts = {_norm(row.get(key)) for key in ("standard_concept", "concept", "label")}
            rank = next((index for index, key in enumerate(preferred_keys) if key in parts), len(preferred_keys))
            candidates.append({"row": row, "value": value, "rank": rank})

        if strict and candidates:
            preferred_candidates = [candidate for candidate in candidates if candidate["rank"] < len(preferred_keys)]
            if preferred_candidates:
                best_rank = min(candidate["rank"] for candidate in preferred_candidates)
                candidates = [candidate for candidate in preferred_candidates if candidate["rank"] == best_rank]

            total_candidates = [candidate for candidate in candidates if candidate["row"].get("is_total") is True]
            if len(total_candidates) == 1:
                candidates = total_candidates

            distinct_values = {candidate["value"] for candidate in candidates}
            if len(distinct_values) > 1:
                ambiguous = _line(None, source="ambiguous", confidence=0.0, method="ambiguous")
                ambiguous["candidates"] = [
                    {
                        "concept": candidate["row"].get("concept") or candidate["row"].get("standard_concept") or candidate["row"].get("label"),
                        "value": candidate["value"],
                        "source": _source_record(candidate["row"], year),
                    }
                    for candidate in candidates
                ]
                series.append(ambiguous)
                continue

            candidates.sort(
                key=lambda candidate: (
                    _norm(candidate["row"].get("concept")),
                    _norm(candidate["row"].get("standard_concept")),
                    _norm(candidate["row"].get("label")),
                )
            )
            picked = candidates[0]
        else:
            picked = None
            for candidate in candidates:
                if picked is None or abs(candidate["value"]) > abs(picked["value"]):
                    picked = candidate

        picked_row = picked["row"] if picked else None
        picked_value = picked["value"] if picked else None
        series.append(_line(
            picked_value,
            source="sec_native" if picked_row else "missing",
            confidence=0.95 if picked_row and strict and preferred_keys else 0.9 if picked_row else 0.0,
            method="preferred_direct" if picked_row and strict and preferred_keys else "direct" if picked_row else "missing",
            concept=str((picked_row or {}).get("concept") or (picked_row or {}).get("standard_concept") or "") or None,
            sources=[_source_record(picked_row, year)] if picked_row else [],
        ))
    return series


def _latest(series: List[Dict[str, Any]]) -> Dict[str, Any]:
    return series[-1] if series else _line(None, source="missing", confidence=0.0, method="missing")


def _source_backed_value(line: Dict[str, Any]) -> bool:
    sources = line.get("sources")
    value = _to_number(line.get("value"))
    return bool(
        line.get("source") in {"sec_native", "derived"}
        and value is not None
        and isinstance(sources, list)
        and sources
        and all(isinstance(source, dict) for source in sources)
    )


def _amounts_reconcile(left: float, right: float, scale: float) -> bool:
    return abs(left - right) <= max(1.0, abs(scale) * 0.001)


def _filed_absence_line(
    native_financials: Dict[str, Any],
    years: List[int],
    source_filings: List[Any],
    rows: List[Dict[str, Any]],
    year: int,
    concepts: tuple[str, ...],
    *,
    field: str,
    currency: str | None,
) -> Dict[str, Any]:
    concept_keys = {_norm(concept) for concept in concepts}
    source_facts = native_financials.get("source_facts")
    source_facts = source_facts if isinstance(source_facts, list) else []
    has_fact = any(
        isinstance(fact, dict)
        and _norm(str(fact.get("concept") or "").split(":")[-1]) in concept_keys
        and str(fact.get("period_end") or "").startswith(str(year))
        and str(fact.get("fiscal_period") or "").upper() == "FY"
        for fact in source_facts
    )
    has_statement_value = any(
        _norm(str(row.get("concept") or row.get("standard_concept") or "")) in concept_keys
        and _value_for_year(row, year) is not None
        for row in rows
    )
    if has_fact or has_statement_value:
        return _line(None, source="missing", confidence=0.0, method=f"reported_{field}_value_unusable")
    if field.startswith("marketable_securities") and any(
        isinstance(fact, dict)
        and _norm(str(fact.get("concept") or "").split(":")[-1]) in concept_keys
        and str(fact.get("period_end") or "")[:4].isdigit()
        and int(str(fact.get("period_end") or "")[:4]) < year
        and str(fact.get("fiscal_period") or "").upper() == "FY"
        for fact in source_facts
    ):
        return _line(None, source="missing", confidence=0.0, method=f"previously_reported_{field}_is_not_currently_mapped")

    filings = [
        filing for filing in source_filings
        if isinstance(filing, dict)
        and str(filing.get("report_date") or "").startswith(str(year))
        and str(filing.get("form") or "") in {"10-K", "10-K/A"}
        and filing.get("accession_number")
        and filing.get("filing_date")
    ]
    if not filings:
        return _line(None, source="missing", confidence=0.0, method=f"missing_{field}_and_annual_filing")
    filing = max(filings, key=lambda item: str(item.get("filing_date") or ""))
    return _line(
        None,
        source="not_applicable",
        confidence=0.9,
        method=f"no_separately_reported_{field}_in_filed_10k",
        concept=field,
        sources=[{
            "concept": None,
            "label": f"No separate {field.replace('_', ' ')} balance was reported in annual XBRL facts or statement rows",
            "statement": "CompanyFacts",
            "row_id": None,
            "fiscal_period": f"FY {year}",
            "reported_value": None,
            "accession": filing.get("accession_number"),
            "filed": filing.get("filing_date"),
            "form": filing.get("form"),
            "report_date": filing.get("report_date"),
            "period_end": filing.get("report_date"),
            "currency": currency,
            "unit": currency,
            "unit_scale": "actual",
            "source_fiscal_year": year,
        }],
    )


def build_canonical_financials(native_financials: Dict[str, Any] | None, market: Dict[str, Any] | None) -> Dict[str, Any]:
    native_financials = native_financials or {}
    market = market or {}
    statements = native_financials.get("statements") or {}
    statement_rows = {
        key: [row for row in statements.get(key, []) if isinstance(row, dict)]
        if isinstance(statements.get(key), list)
        else []
        for key in ("income_statement", "balance_sheet", "cashflow_statement")
    }
    income_rows = statement_rows["income_statement"]
    balance_rows = statement_rows["balance_sheet"]
    cashflow_rows = statement_rows["cashflow_statement"]
    rows: List[Dict[str, Any]] = []
    for key in ("income_statement", "balance_sheet", "cashflow_statement"):
        rows.extend(statement_rows[key])

    years = _years(rows)
    key_metrics = native_financials.get("key_metrics") or {}

    revenue = _pick_series(
        income_rows,
        years,
        "revenue",
        "contractrevenue",
        "productrevenue",
        preferred=("revenuefromcontractwithcustomerexcludingassessedtax", "revenues", "salesrevenuenet", "revenue"),
        strict=True,
    )
    cost_of_revenue_direct = _pick_series(
        income_rows,
        years,
        "costofrevenue",
        "costofgoodssold",
        "costofsales",
        "costofgoodsandservicessold",
        preferred=("costofrevenue", "costofgoodssold", "costofgoodsandservicessold", "costofsales"),
        strict=True,
    )
    combined_operating_costs = _pick_series(
        income_rows,
        years,
        "costsandexpenses",
        exact=True,
        preferred=("costsandexpenses",),
        strict=True,
    )
    gross_profit_direct = _pick_series(
        income_rows,
        years,
        "grossprofit",
        exact=True,
        preferred=("grossprofit",),
        strict=True,
    )
    net_income = _pick_series(
        income_rows,
        years,
        "netincome",
        "profitorloss",
        preferred=(
            "netincomelossavailabletocommonstockholdersbasic",
            "netincomelossavailabletocommonstockholdersdiluted",
            "netincomeloss",
            "profitorloss",
        ),
        strict=True,
    )
    tax = _pick_series(
        income_rows,
        years,
        "incometaxexpense",
        "incometaxexpensebenefit",
        preferred=("incometaxexpensebenefit", "incometaxexpense"),
        strict=True,
    )
    interest = _pick_series(
        income_rows,
        years,
        "interestexpense",
        preferred=("interestexpensenonoperating", "interestexpense"),
        strict=True,
    )
    pretax = _pick_series(
        income_rows,
        years,
        "incomebeforetax",
        "pretaxincome",
        "profitbeforetax",
        "incomelossfromcontinuingoperationsbeforeincometaxes",
        preferred=(
            "incomelossfromcontinuingoperationsbeforeincometaxesextraordinaryitemsnoncontrollinginterest",
            "incomelossfromcontinuingoperationsbeforeincometaxes",
            "incomebeforetax",
            "pretaxincome",
        ),
        strict=True,
    )
    ebit_direct = _pick_series(
        income_rows,
        years,
        "operatingincome",
        "operatingincomeloss",
        exact=True,
        exclude=("nonoperating", "non-operating"),
        preferred=("operatingincomeloss", "operatingincome"),
        strict=True,
    )
    ebit: List[Dict[str, Any]] = []
    for idx, _year in enumerate(years):
        direct = ebit_direct[idx]
        if direct["source"] in {"sec_native", "derived", "ambiguous"}:
            ebit.append(direct)
            continue
        if pretax[idx]["source"] == "ambiguous" or interest[idx]["source"] == "ambiguous":
            ebit.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_ebit_inputs"))
            continue
        pretax_value = pretax[idx]["value"]
        if pretax_value is None and net_income[idx]["value"] is not None and tax[idx]["value"] is not None:
            pretax_value = net_income[idx]["value"] + tax[idx]["value"]
        interest_value = interest[idx]["value"]
        if pretax_value is not None and interest_value is not None:
            ebit.append(_line(
                pretax_value + abs(interest_value),
                source="derived",
                confidence=min(pretax[idx]["confidence"], interest[idx]["confidence"]),
                method="pretax_plus_interest",
                sources=_source_records(pretax[idx], interest[idx]),
            ))
        else:
            ebit.append(_line(None, source="missing", confidence=0.0, method="missing_ebit_inputs"))

    depreciation = _pick_series(
        cashflow_rows,
        years,
        "depreciation",
        "amortization",
        "depreciationandamortization",
        preferred=("depreciationdepletionandamortization", "depreciationandamortization", "depreciation"),
        strict=True,
    )
    ebitda = []
    for idx in range(len(years)):
        if ebit[idx]["value"] is not None and depreciation[idx]["value"] is not None:
            ebitda.append(_line(
                ebit[idx]["value"] + depreciation[idx]["value"],
                source="derived",
                confidence=min(ebit[idx]["confidence"], depreciation[idx]["confidence"]),
                method="ebit_plus_da",
                sources=_source_records(ebit[idx], depreciation[idx]),
            ))
        else:
            ebitda.append(_line(None, source="missing", confidence=0.0, method="missing_ebit_or_da"))
    cfo = _pick_series(
        cashflow_rows,
        years,
        "netcashfromoperatingactivities",
        "netcashprovidedbyusedinoperatingactivities",
        "operatingcashflow",
        preferred=("netcashprovidedbyusedinoperatingactivities", "netcashfromoperatingactivities"),
        strict=True,
    )
    capex = _pick_series(
        cashflow_rows,
        years,
        "paymentstoacquirepropertyplantandequipment",
        "paymentsforpurchaseofpropertyplantandequipment",
        "capitalexpenditures",
        "purchaseofpropertyplantandequipment",
        preferred=(
            "paymentstoacquirepropertyplantandequipment",
            "paymentsforpurchaseofpropertyplantandequipment",
            "capitalexpenditures",
        ),
        strict=True,
    )
    capex = [
        _line(
            abs(item["value"]) if item["value"] is not None else None,
            source=item["source"],
            confidence=item["confidence"],
            method=item["method"],
            concept=item.get("concept"),
            sources=item.get("sources", []),
        )
        for item in capex
    ]
    cash = _pick_series(
        balance_rows,
        years,
        "cashandcashequivalents",
        "cashandcashequivalentsatcarryingvalue",
        preferred=("cashandcashequivalentsatcarryingvalue", "cashandcashequivalents"),
        strict=True,
    )
    marketable_current_concepts = (
        "MarketableSecuritiesCurrent",
        "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
        "AvailableForSaleSecuritiesCurrent",
        "ShortTermInvestments",
        "InvestmentsCurrent",
    )
    marketable_noncurrent_concepts = (
        "MarketableSecuritiesNoncurrent",
        "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent",
        "AvailableForSaleSecuritiesNoncurrent",
        "LongTermInvestments",
        "InvestmentsNoncurrent",
    )
    marketable_current_statement = _pick_series(
        balance_rows,
        years,
        *marketable_current_concepts,
        preferred=marketable_current_concepts,
        strict=True,
    )
    marketable_noncurrent_statement = _pick_series(
        balance_rows,
        years,
        *marketable_noncurrent_concepts,
        preferred=marketable_noncurrent_concepts,
        strict=True,
    )
    marketable_current_facts = _company_fact_series(native_financials, years, "MarketableSecuritiesCurrent")
    marketable_noncurrent_facts = _company_fact_series(native_financials, years, "MarketableSecuritiesNoncurrent")
    marketable_current = _prefer_reported_series(marketable_current_statement, marketable_current_facts)
    marketable_noncurrent = _prefer_reported_series(marketable_noncurrent_statement, marketable_noncurrent_facts)
    source_filings = native_financials.get("source_filings")
    source_filings = source_filings if isinstance(source_filings, list) else []
    for idx, year in enumerate(years):
        if marketable_current[idx]["source"] == "missing":
            marketable_current[idx] = _filed_absence_line(
                native_financials, years, source_filings, balance_rows, year, marketable_current_concepts,
                field="marketable_securities_current", currency=str(market.get("currency") or native_financials.get("currency") or "USD"),
            )
        if marketable_noncurrent[idx]["source"] == "missing":
            marketable_noncurrent[idx] = _filed_absence_line(
                native_financials, years, source_filings, balance_rows, year, marketable_noncurrent_concepts,
                field="marketable_securities_noncurrent", currency=str(market.get("currency") or native_financials.get("currency") or "USD"),
            )
    marketable_securities_current = marketable_current
    marketable_securities_noncurrent = marketable_noncurrent
    marketable_securities = []
    for idx in range(len(years)):
        current = marketable_current[idx]
        noncurrent = marketable_noncurrent[idx]
        current_unit = (current.get("sources") or [{}])[0].get("unit")
        noncurrent_unit = (noncurrent.get("sources") or [{}])[0].get("unit")
        if current["source"] == "ambiguous" or noncurrent["source"] == "ambiguous":
            marketable_securities.append(_line(
                None,
                source="ambiguous",
                confidence=0.0,
                method="ambiguous_current_and_noncurrent_marketable_securities",
                sources=_source_records(current, noncurrent),
            ))
        elif (
            current["value"] is not None
            and noncurrent["value"] is not None
            and current_unit is not None
            and current_unit == noncurrent_unit
        ):
            marketable_securities.append(_line(
                current["value"] + noncurrent["value"],
                source="derived",
                confidence=min(current["confidence"], noncurrent["confidence"]),
                method="sum_current_and_noncurrent_marketable_securities",
                concept="MarketableSecuritiesCurrent+MarketableSecuritiesNoncurrent",
                sources=_source_records(current, noncurrent),
            ))
        elif current["source"] == "not_applicable" and noncurrent["source"] == "not_applicable":
            marketable_securities.append(_line(
                None,
                source="not_applicable",
                confidence=min(current["confidence"], noncurrent["confidence"]),
                method="no_separately_reported_marketable_securities_in_filed_10k",
                sources=_source_records(current, noncurrent),
            ))
        elif (
            current["source"] in {"sec_native", "derived", "not_applicable"}
            and noncurrent["source"] in {"sec_native", "derived", "not_applicable"}
            and (current["value"] is not None or current["source"] == "not_applicable")
            and (noncurrent["value"] is not None or noncurrent["source"] == "not_applicable")
        ):
            marketable_securities.append(_line(
                (0.0 if current["value"] is None else current["value"])
                + (0.0 if noncurrent["value"] is None else noncurrent["value"]),
                source="derived",
                confidence=min(current["confidence"], noncurrent["confidence"]),
                method="sum_reported_marketable_securities_and_filed_not_applicable_portions",
                concept="MarketableSecuritiesCurrent+MarketableSecuritiesNoncurrent",
                sources=_source_records(current, noncurrent),
            ))
        else:
            marketable_securities.append(_line(
                None,
                source="missing",
                confidence=0.0,
                method="missing_or_inconsistent_marketable_securities_inputs",
                sources=_source_records(current, noncurrent),
            ))
    long_term_debt_current = _pick_series(
        balance_rows,
        years,
        "shorttermdebt",
        "shorttermborrowings",
        "debtcurrent",
        "longtermdebtcurrent",
        "currentportionoflongtermdebt",
        preferred=("longtermdebtcurrent", "debtcurrent", "shorttermdebt", "shorttermborrowings"),
        strict=True,
    )
    commercial_paper = _company_fact_series(native_financials, years, "CommercialPaper")
    commercial_paper_statement = _pick_series(
        balance_rows,
        years,
        "commercialpaper",
        preferred=("commercialpaper",),
        strict=True,
    )
    commercial_paper = _prefer_reported_series(commercial_paper_statement, commercial_paper)
    current_debt_concepts = (
        "ShortTermDebt", "DebtCurrent", "LongTermDebtCurrent", "CurrentPortionOfLongTermDebt",
        "ShortTermBorrowings", "CommercialPaper",
    )
    for idx, year in enumerate(years):
        if long_term_debt_current[idx]["source"] == "missing":
            long_term_debt_current[idx] = _filed_absence_line(
                native_financials, years, source_filings, balance_rows, year, current_debt_concepts,
                field="current_debt", currency=str(market.get("currency") or native_financials.get("currency") or "USD"),
            )
        if commercial_paper[idx]["source"] == "missing":
            commercial_paper[idx] = _filed_absence_line(
                native_financials, years, source_filings, balance_rows, year, ("CommercialPaper",),
                field="commercial_paper", currency=str(market.get("currency") or native_financials.get("currency") or "USD"),
            )
    debt_current = []
    for idx in range(len(years)):
        current = long_term_debt_current[idx]
        paper = commercial_paper[idx]
        if current["source"] == "ambiguous" or paper["source"] == "ambiguous":
            debt_current.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_current_debt_inputs"))
        elif (
            current["source"] in {"sec_native", "derived", "not_applicable"}
            and paper["source"] in {"sec_native", "derived", "not_applicable"}
            and (current["value"] is not None or current["source"] == "not_applicable")
            and (paper["value"] is not None or paper["source"] == "not_applicable")
        ):
            debt_current.append(_line(
                (0.0 if current["value"] is None else current["value"])
                + (0.0 if paper["value"] is None else paper["value"]),
                source="derived",
                confidence=min(current["confidence"], paper["confidence"]),
                method="current_debt_and_commercial_paper_with_filed_absence_when_not_reported",
                sources=_source_records(current, paper),
            ))
        else:
            debt_current.append(_line(None, source="missing", confidence=0.0, method="incomplete_current_debt_inputs", sources=_source_records(current, paper)))
    debt_long = _pick_series(
        balance_rows,
        years,
        "longtermdebt",
        "longtermdebtnoncurrent",
        exclude=("longtermdebtcurrent", "currentportionoflongtermdebt"),
        preferred=("longtermdebtnoncurrent", "longtermdebt"),
        strict=True,
    )
    long_term_debt_concepts = ("LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent")
    for idx, year in enumerate(years):
        if debt_long[idx]["source"] == "missing":
            debt_long[idx] = _filed_absence_line(
                native_financials, years, source_filings, balance_rows, year, long_term_debt_concepts,
                field="long_term_debt", currency=str(market.get("currency") or native_financials.get("currency") or "USD"),
            )
    operating_lease_current = _pick_series(
        balance_rows,
        years,
        "operatingleaseliabilitycurrent",
        preferred=("operatingleaseliabilitycurrent",),
        strict=True,
    )
    operating_lease_noncurrent = _pick_series(
        balance_rows,
        years,
        "operatingleaseliabilitynoncurrent",
        preferred=("operatingleaseliabilitynoncurrent",),
        strict=True,
    )
    lease_liabilities = []
    for idx in range(len(years)):
        current = operating_lease_current[idx]
        noncurrent = operating_lease_noncurrent[idx]
        if current["source"] == "ambiguous" or noncurrent["source"] == "ambiguous":
            lease_liabilities.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_operating_lease_liabilities", sources=_source_records(current, noncurrent)))
        elif current["value"] is not None and noncurrent["value"] is not None:
            lease_liabilities.append(_line(
                current["value"] + noncurrent["value"],
                source="derived",
                confidence=min(current["confidence"], noncurrent["confidence"]),
                method="current_plus_noncurrent_operating_lease_liabilities",
                sources=_source_records(current, noncurrent),
            ))
        else:
            lease_liabilities.append(_line(None, source="missing", confidence=0.0, method="missing_operating_lease_inputs", sources=_source_records(current, noncurrent)))
    debt = [
        _line(
            (0.0 if debt_current[idx]["value"] is None else debt_current[idx]["value"])
            + (0.0 if debt_long[idx]["value"] is None else debt_long[idx]["value"])
            if debt_current[idx]["source"] in {"sec_native", "derived", "not_applicable"}
            and debt_long[idx]["source"] in {"sec_native", "derived", "not_applicable"}
            and (debt_current[idx]["value"] is not None or debt_current[idx]["source"] == "not_applicable")
            and (debt_long[idx]["value"] is not None or debt_long[idx]["source"] == "not_applicable")
            else None,
            source=(
                "ambiguous"
                if "ambiguous" in (debt_current[idx]["source"], debt_long[idx]["source"])
                else "derived"
                if debt_current[idx]["source"] in {"sec_native", "derived", "not_applicable"}
                and debt_long[idx]["source"] in {"sec_native", "derived", "not_applicable"}
                and (debt_current[idx]["value"] is not None or debt_current[idx]["source"] == "not_applicable")
                and (debt_long[idx]["value"] is not None or debt_long[idx]["source"] == "not_applicable")
                else "missing"
            ),
            confidence=min(debt_current[idx]["confidence"], debt_long[idx]["confidence"]),
            method="current_plus_long_term_debt_with_filed_absence_when_not_reported",
            concept="current_plus_long_term_debt",
            sources=_source_records(debt_current[idx], debt_long[idx]),
        )
        for idx in range(len(years))
    ]
    book_value = _pick_series(
        balance_rows,
        years,
        "stockholdersequity",
        "shareholdersequity",
        "totalequity",
        exclude=("liabilitiesandstockholdersequity", "liabilitiesandequity", "redeemablenoncontrollinginterest"),
        preferred=("stockholdersequityattributabletoparent", "stockholdersequity", "shareholdersequity", "totalequity"),
        strict=True,
    )
    total_assets = _pick_series(
        balance_rows,
        years,
        "assets",
        exact=True,
        preferred=("assets",),
        strict=True,
    )
    total_liabilities = _pick_series(
        balance_rows,
        years,
        "liabilities",
        exact=True,
        exclude=("liabilitiesandstockholdersequity", "liabilitiesandequity"),
        preferred=("liabilities",),
        strict=True,
    )
    total_current_assets = _pick_series(
        balance_rows,
        years,
        "assetscurrent",
        "totalcurrentassets",
        preferred=("assetscurrent", "totalcurrentassets"),
        strict=True,
    )
    total_current_liabilities = _pick_series(
        balance_rows,
        years,
        "liabilitiescurrent",
        "totalcurrentliabilities",
        preferred=("liabilitiescurrent", "totalcurrentliabilities"),
        strict=True,
    )
    other_current_assets = _pick_series(
        balance_rows,
        years,
        "othercurrentassets",
        "prepaidexpenseandotherassetscurrent",
        preferred=("otherassetscurrent", "prepaidexpenseandotherassetscurrent", "othercurrentassets"),
        strict=True,
    )
    other_current_assets_facts = _company_fact_series(native_financials, years, "OtherAssetsCurrent")
    other_current_assets = _prefer_reported_series(other_current_assets, other_current_assets_facts)
    ppe_net = _pick_series(
        balance_rows,
        years,
        "propertyplantandequipmentnet",
        "propertyplantandequipment",
        preferred=("propertyplantandequipmentnet", "propertyplantandequipment"),
        strict=True,
    )
    other_assets = _pick_series(
        balance_rows,
        years,
        "otherassetsnoncurrent",
        "otherassets",
        exclude=("otherassetscurrent", "othercurrentassets"),
        preferred=("otherassetsnoncurrent", "otherassets"),
        strict=True,
    )
    other_liabilities = _pick_series(
        balance_rows,
        years,
        "otherliabilitiesnoncurrent",
        "otherliabilities",
        exclude=("otherliabilitiescurrent", "othercurrentliabilities"),
        preferred=("otherliabilitiesnoncurrent", "otherliabilities"),
        strict=True,
    )
    other_current_liabilities = _pick_series(
        balance_rows,
        years,
        "otherliabilitiescurrent",
        "othercurrentliabilities",
        exclude=("liabilitiesandstockholdersequity", "liabilitiesandequity"),
        preferred=("otherliabilitiescurrent", "othercurrentliabilities"),
        strict=True,
    )
    other_current_liabilities = _prefer_reported_series(
        other_current_liabilities,
        _company_fact_series(native_financials, years, "OtherLiabilitiesCurrent"),
    )
    deferred_revenue = _pick_series(
        balance_rows,
        years,
        "deferredrevenue",
        "contractwithcustomerliability",
        preferred=("contractwithcustomerliabilitycurrent", "deferredrevenuecurrent", "deferredrevenue"),
        strict=True,
    )
    deferred_revenue = _prefer_reported_series(
        deferred_revenue,
        _company_fact_series(native_financials, years, "ContractWithCustomerLiability"),
    )
    research_and_development = _pick_series(
        income_rows,
        years,
        "researchanddevelopmentexpense",
        preferred=("researchanddevelopmentexpense",),
        strict=True,
    )
    general_and_administrative = _pick_series(
        income_rows,
        years,
        "sellinggeneralandadministrativeexpense",
        "generalandadministrativeexpense",
        preferred=("sellinggeneralandadministrativeexpense", "generalandadministrativeexpense"),
        strict=True,
    )
    marketing = _pick_series(
        income_rows,
        years,
        "sellingandmarketingexpense",
        "marketingexpense",
        "advertisingexpense",
        preferred=("sellingandmarketingexpense", "marketingexpense", "advertisingexpense"),
        strict=True,
    )
    rent = _pick_series(
        income_rows,
        years,
        "operatingleasecost",
        "rentexpense",
        preferred=("operatingleasecost", "rentexpense"),
        strict=True,
    )
    bad_debt = _pick_series(
        income_rows,
        years,
        "baddebt",
        "provisionforcreditlosses",
        "provisionfordoubtfulaccounts",
        preferred=("provisionforcreditlosses", "baddebt", "provisionfordoubtfulaccounts"),
        strict=True,
    )
    other_operating_expenses_direct = _pick_series(
        income_rows,
        years,
        "otheroperatingexpenses",
        "othercostandexpenseoperating",
        preferred=("otheroperatingexpenses", "othercostandexpenseoperating"),
        strict=True,
    )
    other_operating_income_expense = _pick_series(
        income_rows,
        years,
        "otheroperatingincomeexpensenet",
        exact=True,
        preferred=("otheroperatingincomeexpensenet",),
        strict=True,
    )
    deferred_tax = _pick_series(
        cashflow_rows,
        years,
        "deferredincometaxexpensebenefit",
        "deferredtaxexpensebenefit",
        preferred=("deferredincometaxexpensebenefit", "deferredtaxexpensebenefit"),
        strict=True,
    )
    other_non_cash = _pick_series(
        cashflow_rows,
        years,
        "othernoncashincomeexpense",
        "othernoncashadjustmentstonetincome",
        preferred=("othernoncashincomeexpense", "othernoncashadjustmentstonetincome"),
        strict=True,
    )
    accounts_receivable = _pick_series(
        balance_rows,
        years,
        "accountsreceivable",
        "receivablesnetcurrent",
        exclude=("increasedecrease", "cashflow"),
        preferred=("accountsreceivablenetcurrent", "accountsreceivablecurrent", "accountsreceivable"),
        strict=True,
    )
    inventory = _pick_series(
        balance_rows,
        years,
        "inventory",
        preferred=("inventorynet", "inventory"),
        strict=True,
    )
    accounts_payable = _pick_series(
        balance_rows,
        years,
        "accountspayable",
        exclude=("increasedecrease", "cashflow"),
        preferred=("accountspayablecurrent", "accountspayable"),
        strict=True,
    )
    retained_earnings = _pick_series(
        balance_rows,
        years,
        "retainedearnings",
        preferred=("retainedearningsaccumulateddeficit", "retainedearnings"),
        strict=True,
    )
    stock_based_comp = _pick_series(
        cashflow_rows,
        years,
        "sharebasedcompensation",
        "stockbasedcompensation",
        preferred=("sharebasedcompensation", "stockbasedcompensation"),
        strict=True,
    )
    dividends_paid = _pick_series(
        cashflow_rows,
        years,
        "paymentsofdividendscommonstock",
        "paymentsofdividends",
        "dividendspaid",
        preferred=("paymentsofdividendscommonstock", "paymentsofdividends", "dividendspaid"),
        strict=True,
    )
    preferred_equity = _pick_series(
        balance_rows,
        years,
        "preferredstockvalue",
        "preferredstockvalueoutstanding",
        "preferredstockincludingadditionalpaidincapital",
        "preferredstockincludingadditionalpaidincapitalnetofdiscount",
        "preferredstockcarryingvalue",
        preferred=(
            "preferredstockvalue",
            "preferredstockvalueoutstanding",
            "preferredstockincludingadditionalpaidincapital",
            "preferredstockcarryingvalue",
        ),
        strict=True,
    )
    for preferred_concept in PREFERRED_EQUITY_CONCEPTS:
        preferred_equity = _prefer_reported_series(
            preferred_equity,
            _company_fact_series(native_financials, years, preferred_concept),
        )
    source_filings = native_financials.get("source_filings")
    source_filings = source_filings if isinstance(source_filings, list) else []
    for idx, year in enumerate(years):
        if preferred_equity[idx]["source"] != "missing":
            continue
        preferred_facts = [
            fact for fact in native_financials.get("source_facts", [])
            if isinstance(fact, dict)
            and _norm(str(fact.get("concept") or "").split(":")[-1]) in {_norm(concept) for concept in PREFERRED_EQUITY_CONCEPTS}
            and str(fact.get("period_end") or "").startswith(str(year))
        ]
        filing = next((
            item for item in source_filings
            if isinstance(item, dict) and str(item.get("report_date") or "").startswith(str(year))
        ), None)
        if not preferred_facts and filing is not None:
            preferred_equity[idx] = _line(
                None,
                source="not_applicable",
                confidence=0.9,
                method="no_preferred_stock_fact_disclosed_in_filed_10k",
                concept="preferred_equity",
                sources=[{
                    "concept": None,
                    "label": "Preferred equity not reported as outstanding in annual XBRL facts",
                    "statement": "CompanyFacts",
                    "row_id": None,
                    "fiscal_period": f"FY {year}",
                    "reported_value": None,
                    "accession": filing.get("accession_number"),
                    "filed": filing.get("filing_date"),
                    "form": filing.get("form"),
                    "report_date": filing.get("report_date"),
                    "period_end": filing.get("report_date"),
                    "currency": market.get("currency"),
                    "unit": market.get("currency"),
                    "unit_scale": "actual",
                    "source_fiscal_year": year,
                }],
            )
    non_controlling_interest = _pick_series(
        balance_rows,
        years,
        "minorityinterest",
        "noncontrollinginterest",
        exclude=("redeemablenoncontrollinginterest",),
        preferred=("minorityinterest", "noncontrollinginterest"),
        strict=True,
    )
    balance_sheet_check = []
    for idx, year in enumerate(years):
        components = (total_assets[idx], total_liabilities[idx], book_value[idx])
        if any(line["source"] == "ambiguous" for line in components) or non_controlling_interest[idx]["source"] == "ambiguous":
            balance_sheet_check.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_balance_sheet_inputs"))
            continue
        if any(line["value"] is None for line in components):
            balance_sheet_check.append(_line(None, source="missing", confidence=0.0, method="missing_balance_sheet_inputs"))
            continue

        nci_line = non_controlling_interest[idx]
        if nci_line["value"] is None:
            residual_nci = components[0]["value"] - components[1]["value"] - components[2]["value"]
            tolerance = max(1.0, abs(components[0]["value"]) * 1e-8)
            if abs(residual_nci) <= tolerance:
                nci_line = _line(
                    0.0,
                    source="derived",
                    confidence=min(line["confidence"] for line in components),
                    method="balance_sheet_zero_residual_confirmed",
                    concept="noncontrollinginterest",
                    sources=_source_records(*components),
                )
                non_controlling_interest[idx] = nci_line
            else:
                balance_sheet_check.append(_line(None, source="missing", confidence=0.0, method="missing_noncontrolling_interest"))
                continue

        difference = components[0]["value"] - components[1]["value"] - components[2]["value"] - nci_line["value"]
        balance_sheet_check.append(_line(
            difference,
            source="derived",
            confidence=min(line["confidence"] for line in (*components, nci_line)),
            method="assets_less_liabilities_equity_and_nci",
            sources=_source_records(*components, nci_line),
        ))

    tax_rate = []
    for idx in range(len(years)):
        pretax_value = pretax[idx]["value"]
        tax_value = tax[idx]["value"]
        if pretax_value is None and net_income[idx]["value"] is not None and tax_value is not None:
            pretax_value = net_income[idx]["value"] + tax_value
        if pretax_value is None or tax_value is None:
            tax_rate.append(_line(None, source="missing", confidence=0.0, method="missing_tax_inputs"))
        elif pretax_value == 0:
            tax_rate.append(_line(None, source="not_applicable", confidence=1.0, method="zero_pretax_income"))
        else:
            tax_rate.append(_line(
                abs(tax_value / pretax_value),
                source="derived",
                confidence=min(tax[idx]["confidence"], pretax[idx]["confidence"]),
                method="income_tax_expense_over_pretax_income",
                sources=_source_records(tax[idx], pretax[idx]),
            ))

    cost_of_revenue: List[Dict[str, Any]] = []
    gross_profit: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        revenue_line = revenue[idx]
        direct_cost = cost_of_revenue_direct[idx]
        direct_gross_profit = gross_profit_direct[idx]
        combined_costs = combined_operating_costs[idx]
        operating_expense_lines = (
            general_and_administrative[idx],
            research_and_development[idx],
            other_operating_income_expense[idx],
        )
        revenue_value = _to_number(revenue_line.get("value"))
        direct_cost_value = _to_number(direct_cost.get("value"))
        direct_gross_profit_value = _to_number(direct_gross_profit.get("value"))
        combined_cost_value = _to_number(combined_costs.get("value"))
        ebit_value = _to_number(ebit[idx].get("value"))

        reconciled_cost: Dict[str, Any] | None = None
        if (
            _source_backed_value(revenue_line)
            and _source_backed_value(combined_costs)
            and _source_backed_value(ebit[idx])
            and all(_source_backed_value(line) for line in operating_expense_lines)
            and revenue_value is not None
            and combined_cost_value is not None
            and ebit_value is not None
        ):
            total_costs = abs(combined_cost_value)
            # SG&A and R&D are expense lines; OtherOperatingIncomeExpenseNet is signed,
            # so a negative filed amount is an expense and a positive amount is income.
            specified_operating_expenses = (
                abs(float(operating_expense_lines[0]["value"]))
                + abs(float(operating_expense_lines[1]["value"]))
                - float(operating_expense_lines[2]["value"])
            )
            implied_ebit = revenue_value - total_costs
            residual_cost_of_revenue = total_costs - specified_operating_expenses
            if _amounts_reconcile(implied_ebit, ebit_value, revenue_value):
                if residual_cost_of_revenue >= 0:
                    if (
                        _source_backed_value(direct_cost)
                        and direct_cost_value is not None
                        and _amounts_reconcile(abs(direct_cost_value), residual_cost_of_revenue, total_costs)
                    ):
                        reconciled_cost = direct_cost
                    else:
                        reconciled_cost = _line(
                            residual_cost_of_revenue,
                            source="derived",
                            confidence=min(line["confidence"] for line in (combined_costs, *operating_expense_lines)),
                            method="combined_costs_less_reported_operating_expenses",
                            concept="cost_of_revenue",
                            sources=_source_records(combined_costs, *operating_expense_lines),
                        )
                else:
                    reconciled_cost = _line(
                        None,
                        source="ambiguous",
                        confidence=0.0,
                        method="negative_cost_of_revenue_residual",
                        sources=_source_records(combined_costs, *operating_expense_lines),
                    )
            elif (
                _source_backed_value(direct_cost)
                and direct_cost_value is not None
                and _amounts_reconcile(
                    revenue_value
                    - abs(direct_cost_value)
                    - specified_operating_expenses,
                    ebit_value,
                    revenue_value,
                )
            ):
                reconciled_cost = _line(
                    abs(direct_cost_value),
                    source="sec_native",
                    confidence=direct_cost["confidence"],
                    method="reported_cost_of_revenue_reconciles_to_ebit",
                    concept=direct_cost.get("concept"),
                    sources=direct_cost.get("sources", []),
                )

        if reconciled_cost is None and _source_backed_value(combined_costs):
            # A combined expense total is present, but its components do not bridge
            # to EBIT. Do not accept a conflicting direct tag as COGS.
            if (
                _source_backed_value(direct_cost)
                and _source_backed_value(direct_gross_profit)
                and _source_backed_value(revenue_line)
                and direct_cost_value is not None
                and direct_gross_profit_value is not None
                and revenue_value is not None
                and _amounts_reconcile(abs(direct_cost_value) + direct_gross_profit_value, revenue_value, revenue_value)
            ):
                reconciled_cost = _line(
                    abs(direct_cost_value),
                    source="sec_native",
                    confidence=min(direct_cost["confidence"], direct_gross_profit["confidence"]),
                    method="reported_cost_and_gross_profit_reconcile_to_revenue",
                    concept=direct_cost.get("concept"),
                    sources=_source_records(direct_cost, direct_gross_profit),
                )
            else:
                reconciled_cost = _line(
                    None,
                    source="ambiguous",
                    confidence=0.0,
                    method="unreconciled_combined_operating_costs",
                    sources=_source_records(combined_costs, direct_cost, direct_gross_profit),
                )

        if reconciled_cost is None and _source_backed_value(direct_cost):
            if direct_cost_value is None:
                reconciled_cost = _line(None, source="missing", confidence=0.0, method="invalid_reported_cost_of_revenue")
            elif (
                _source_backed_value(direct_gross_profit)
                and _source_backed_value(revenue_line)
                and direct_gross_profit_value is not None
                and revenue_value is not None
                and not _amounts_reconcile(abs(direct_cost_value) + direct_gross_profit_value, revenue_value, revenue_value)
            ):
                reconciled_cost = _line(
                    None,
                    source="ambiguous",
                    confidence=0.0,
                    method="reported_cost_and_gross_profit_do_not_reconcile_to_revenue",
                    sources=_source_records(direct_cost, direct_gross_profit, revenue_line),
                )
            else:
                reconciled_cost = _line(
                    abs(direct_cost_value),
                    source="sec_native",
                    confidence=direct_cost["confidence"],
                    method="reported_cost_of_revenue_normalized_positive",
                    concept=direct_cost.get("concept"),
                    sources=direct_cost.get("sources", []),
                )
        elif reconciled_cost is None and _source_backed_value(revenue_line) and _source_backed_value(direct_gross_profit):
            if revenue_value is not None and direct_gross_profit_value is not None:
                implied_cost = revenue_value - direct_gross_profit_value
                reconciled_cost = _line(
                    implied_cost if implied_cost >= 0 else None,
                    source="derived" if implied_cost >= 0 else "ambiguous",
                    confidence=min(revenue_line["confidence"], direct_gross_profit["confidence"]),
                    method="revenue_less_reported_gross_profit",
                    concept="cost_of_revenue",
                    sources=_source_records(revenue_line, direct_gross_profit),
                )
        if reconciled_cost is None:
            reconciled_cost = _line(None, source="missing", confidence=0.0, method="missing_cost_of_revenue")
        cost_of_revenue.append(reconciled_cost)

        if (
            reconciled_cost.get("value") is not None
            and _source_backed_value(reconciled_cost)
            and _source_backed_value(revenue_line)
            and revenue_value is not None
        ):
            derived_gross_profit = revenue_value - float(reconciled_cost["value"])
            if (
                _source_backed_value(direct_gross_profit)
                and direct_gross_profit_value is not None
                and not _amounts_reconcile(direct_gross_profit_value, derived_gross_profit, revenue_value)
            ):
                gross_profit.append(_line(
                    None,
                    source="ambiguous",
                    confidence=0.0,
                    method="reported_gross_profit_conflicts_with_reconciled_cost_of_revenue",
                    sources=_source_records(direct_gross_profit, reconciled_cost, revenue_line),
                ))
            else:
                gross_profit.append(_line(
                    derived_gross_profit,
                    source="derived",
                    confidence=min(revenue_line["confidence"], reconciled_cost["confidence"]),
                    method="revenue_less_reconciled_cost_of_revenue",
                    concept="gross_profit",
                    sources=_source_records(revenue_line, reconciled_cost),
                ))
        elif reconciled_cost.get("source") == "ambiguous":
            gross_profit.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_cost_of_revenue"))
        else:
            gross_profit.append(_line(None, source="missing", confidence=0.0, method="missing_revenue_or_cost_of_revenue"))

    operating_net_working_capital = []
    for idx in range(len(years)):
        components = (
            total_current_assets[idx],
            cash[idx],
            marketable_securities[idx],
            total_current_liabilities[idx],
            debt_current[idx],
        )
        if any(line["source"] == "ambiguous" for line in components):
            operating_net_working_capital.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_aggregate_operating_working_capital_inputs", sources=_source_records(*components)))
            continue

        def disclosed_or_absent_value(line: Dict[str, Any]) -> float | None:
            if line.get("source") == "not_applicable":
                sources = line.get("sources")
                if isinstance(sources, list) and sources and all(
                    isinstance(source, dict) and source.get("accession") and source.get("filed")
                    for source in sources
                ):
                    return 0.0
                return None
            return _to_number(line.get("value")) if _source_backed_value(line) else None

        values = [disclosed_or_absent_value(line) for line in components]
        if any(value is None for value in values):
            operating_net_working_capital.append(_line(None, source="missing", confidence=0.0, method="missing_aggregate_operating_working_capital_inputs", sources=_source_records(*components)))
            continue
        total_current_asset_value, cash_value, securities_value, total_current_liability_value, current_debt_value = values
        aggregate_nwc = total_current_asset_value - cash_value - securities_value - total_current_liability_value + current_debt_value
        operating_net_working_capital.append(_line(
            aggregate_nwc,
            source="derived",
            confidence=min(line["confidence"] for line in components),
            method="noncash_current_assets_less_current_liabilities_plus_current_debt",
            concept="operating_net_working_capital",
            sources=_source_records(*components),
        ))

    nwc_change = []
    for idx in range(len(years)):
        if idx == 0:
            nwc_change.append(_line(None, source="not_applicable", confidence=1.0, method="no_prior_fiscal_period"))
            continue
        current_components = (accounts_receivable[idx], inventory[idx], accounts_payable[idx])
        prior_components = (accounts_receivable[idx - 1], inventory[idx - 1], accounts_payable[idx - 1])
        all_components = (*current_components, *prior_components)
        if any(line["source"] == "ambiguous" for line in all_components):
            nwc_change.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_working_capital_inputs"))
        elif all(line["value"] is not None for line in all_components):
            current_nwc = current_components[0]["value"] + current_components[1]["value"] - current_components[2]["value"]
            prior_nwc = prior_components[0]["value"] + prior_components[1]["value"] - prior_components[2]["value"]
            nwc_change.append(_line(
                current_nwc - prior_nwc,
                source="derived",
                confidence=min(line["confidence"] for line in all_components),
                method="change_in_accounts_receivable_plus_inventory_less_accounts_payable",
                sources=_source_records(*all_components),
            ))
        else:
            nwc_change.append(_line(None, source="missing", confidence=0.0, method="missing_working_capital_inputs"))

    other_operating_expenses = []
    fcff = []
    for idx in range(len(years)):
        direct_other_opex = other_operating_expenses_direct[idx]
        components = (gross_profit[idx], ebit[idx], research_and_development[idx], general_and_administrative[idx])
        if direct_other_opex["source"] in {"sec_native", "ambiguous"}:
            other_operating_expenses.append(direct_other_opex)
        elif all(line["value"] is not None for line in components):
            other_operating_expenses.append(_line(
                components[0]["value"] - components[1]["value"] - components[2]["value"] - components[3]["value"],
                source="derived",
                confidence=min(line["confidence"] for line in components),
                method="gross_profit_less_ebit_rd_and_sga",
                sources=_source_records(*components),
            ))
        else:
            other_operating_expenses.append(_line(None, source="missing", confidence=0.0, method="missing_operating_expense_inputs"))

        if nwc_change[idx]["source"] == "not_applicable":
            fcff.append(_line(None, source="not_applicable", confidence=1.0, method="no_prior_fiscal_period"))
            continue
        cash_flow_components = (ebit[idx], tax_rate[idx], depreciation[idx], capex[idx], nwc_change[idx])
        if any(line["source"] == "ambiguous" for line in cash_flow_components):
            fcff.append(_line(None, source="ambiguous", confidence=0.0, method="ambiguous_fcff_inputs"))
        elif all(line["value"] is not None for line in cash_flow_components):
            fcff_value = (
                cash_flow_components[0]["value"] * (1 - cash_flow_components[1]["value"])
                + cash_flow_components[2]["value"]
                - cash_flow_components[3]["value"]
                - cash_flow_components[4]["value"]
            )
            fcff.append(_line(
                fcff_value,
                source="derived",
                confidence=min(line["confidence"] for line in cash_flow_components),
                method="ebit_after_tax_plus_da_less_capex_and_nwc_change",
                sources=_source_records(*cash_flow_components),
            ))
        else:
            fcff.append(_line(None, source="missing", confidence=0.0, method="missing_fcff_inputs"))

    shares = _company_fact_series(native_financials, years, "WeightedAverageNumberOfDilutedSharesOutstanding")

    bank_income = _pick_series(
        income_rows,
        years,
        "interestincomeoperating",
        "interestanddividendincomeoperating",
        exact=True,
        preferred=("interestincomeoperating", "interestanddividendincomeoperating"),
        strict=True,
    )
    bank_interest_expense = _pick_series(
        income_rows,
        years,
        "interestexpenseoperating",
        "interestexpense",
        preferred=("interestexpenseoperating", "interestexpense"),
        strict=True,
    )
    bank_net_interest_income = _pick_series(
        income_rows,
        years,
        "interestincomeexpensenet",
        "netinterestincome",
        exact=True,
        preferred=("interestincomeexpensenet", "netinterestincome"),
        strict=True,
    )
    bank_noninterest_income = _bank_filing_series(native_financials, years, "BankNoninterestIncome")
    bank_noninterest_expense = _bank_filing_series(native_financials, years, "BankNoninterestExpense")
    bank_provision_filed = _bank_filing_series(native_financials, years, "BankProvisionForCreditLosses")
    bank_provision_reported = _pick_series(
        income_rows + cashflow_rows,
        years,
        "provisionforcreditlosses",
        "provisionforloanleaseandotherlosses",
        preferred=("provisionforcreditlosses", "provisionforloanleaseandotherlosses"),
        strict=True,
    )
    bank_provision = _prefer_reported_series(bank_provision_reported, bank_provision_filed)
    bank_loans = _company_fact_series(
        native_financials,
        years,
        "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss",
    )
    bank_deposits = _company_fact_series(native_financials, years, "Deposits")
    bank_interest_bearing_liabilities = _bank_filing_series(
        native_financials, years, "BankAverageInterestBearingLiabilities",
    )
    bank_interest_earning_assets = _bank_filing_series(
        native_financials, years, "BankAverageInterestEarningAssets",
    )
    bank_rwa = _bank_filing_series(native_financials, years, "BankRiskWeightedAssets")
    bank_cet1 = _bank_filing_series(native_financials, years, "BankCET1Capital")
    bank_minimum_cet1_ratio = _bank_ratio_series(native_financials, years, "BankMinimumCet1Ratio")
    bank_buybacks = _pick_series(
        cashflow_rows,
        years,
        "paymentsforrepurchaseofcommonstock",
        preferred=("paymentsforrepurchaseofcommonstock",),
        strict=True,
    )
    bank_dividends = dividends_paid
    bank_common_dividends_declared = _bank_filing_series(
        native_financials,
        years,
        "BankCommonDividendsDeclared",
    )

    bank_series: Dict[str, List[Dict[str, Any]]] = {
        "interest_income": [],
        "interest_expense": [],
        "net_interest_income": [],
        "noninterest_income": [],
        "noninterest_expense": [],
        "provision_for_credit_losses": [],
        "loans_and_leases": bank_loans,
        "deposits": bank_deposits,
        "interest_bearing_liabilities": bank_interest_bearing_liabilities,
        "interest_earning_assets": bank_interest_earning_assets,
        "risk_weighted_assets": bank_rwa,
        "cet1_capital": bank_cet1,
        "minimum_cet1_ratio": bank_minimum_cet1_ratio,
        "common_equity": [],
        "common_equity_distributions": [],
        "diluted_shares": shares,
    }
    for idx, year in enumerate(years):
        interest_expense_line = bank_interest_expense[idx]
        if interest_expense_line["source"] == "missing":
            interest_expense_line = interest[idx]

        net_interest_line = bank_net_interest_income[idx]
        if net_interest_line["value"] is None and bank_income[idx]["value"] is not None and interest_expense_line["value"] is not None:
            net_interest_line = _line(
                bank_income[idx]["value"] - abs(interest_expense_line["value"]),
                source="derived",
                confidence=min(bank_income[idx]["confidence"], interest_expense_line["confidence"]),
                method="interest_income_less_interest_expense",
                concept="interest_income_less_interest_expense",
                sources=_source_records(bank_income[idx], interest_expense_line),
            )

        interest_income_line = bank_income[idx]
        if interest_income_line["value"] is None and net_interest_line["value"] is not None and interest_expense_line["value"] is not None:
            interest_income_line = _line(
                net_interest_line["value"] + abs(interest_expense_line["value"]),
                source="derived",
                confidence=min(net_interest_line["confidence"], interest_expense_line["confidence"]),
                method="net_interest_income_plus_interest_expense",
                concept="net_interest_income_plus_interest_expense",
                sources=_source_records(net_interest_line, interest_expense_line),
            )

        noninterest_income_line = bank_noninterest_income[idx]
        if noninterest_income_line["value"] is None and revenue[idx]["value"] is not None and net_interest_line["value"] is not None:
            noninterest_income_line = _line(
                revenue[idx]["value"] - net_interest_line["value"],
                source="derived",
                confidence=min(revenue[idx]["confidence"], net_interest_line["confidence"]),
                method="total_revenue_less_net_interest_income",
                concept="total_revenue_less_net_interest_income",
                sources=_source_records(revenue[idx], net_interest_line),
            )

        pretax_line = pretax[idx]
        provision_line = bank_provision[idx]
        noninterest_expense_line = bank_noninterest_expense[idx]
        if (
            noninterest_expense_line["value"] is None
            and revenue[idx]["value"] is not None
            and provision_line["value"] is not None
            and pretax_line["value"] is not None
        ):
            noninterest_expense_line = _line(
                revenue[idx]["value"] - abs(provision_line["value"]) - pretax_line["value"],
                source="derived",
                confidence=min(revenue[idx]["confidence"], provision_line["confidence"], pretax_line["confidence"]),
                method="total_revenue_less_credit_provision_and_pretax_income",
                concept="total_revenue_less_credit_provision_and_pretax_income",
                sources=_source_records(revenue[idx], provision_line, pretax_line),
            )

        book_line = book_value[idx]
        preferred_line = preferred_equity[idx]
        nci_line = non_controlling_interest[idx]
        common_equity_line = _common_equity_line(book_line, preferred_line, nci_line)

        dividends_line = bank_common_dividends_declared[idx]
        if dividends_line["source"] == "missing":
            dividends_line = bank_dividends[idx]
        buybacks_line = bank_buybacks[idx]
        if dividends_line["value"] is not None:
            dividends_line = {**dividends_line, "value": abs(dividends_line["value"])}
        if buybacks_line["value"] is not None:
            buybacks_line = {**buybacks_line, "value": abs(buybacks_line["value"])}
        distributions_line = _sum_lines(
            dividends_line,
            buybacks_line,
            method="common_dividends_plus_common_stock_repurchases",
            concept="common_equity_distributions",
        )

        bank_series["interest_income"].append(interest_income_line)
        bank_series["interest_expense"].append(interest_expense_line)
        bank_series["net_interest_income"].append(net_interest_line)
        bank_series["noninterest_income"].append(noninterest_income_line)
        bank_series["noninterest_expense"].append(noninterest_expense_line)
        bank_series["provision_for_credit_losses"].append(provision_line)
        bank_series["common_equity"].append(common_equity_line)
        bank_series["common_equity_distributions"].append(distributions_line)

    insurance_premiums_written = _insurance_filing_series(native_financials, years, "InsuranceNetPremiumsWritten")
    insurance_premiums_earned = _insurance_filing_series(native_financials, years, "InsuranceNetPremiumsEarned")
    insurance_losses_and_lae = _insurance_filing_series(native_financials, years, "InsuranceLossesAndLAE")
    insurance_acquisition_expenses = _insurance_filing_series(native_financials, years, "InsuranceAcquisitionExpenses")
    insurance_general_operating_expenses = _insurance_filing_series(native_financials, years, "InsuranceGeneralOperatingExpenses")
    insurance_underwriting_expenses = [
        _sum_lines(
            insurance_acquisition_expenses[idx],
            insurance_general_operating_expenses[idx],
            method="acquisition_plus_general_underwriting_expenses",
            concept="insurance_underwriting_expenses",
        )
        for idx in range(len(years))
    ]
    insurance_loss_ratio = _insurance_filing_series(native_financials, years, "InsuranceLossRatio", is_ratio=True)
    insurance_expense_ratio = _insurance_filing_series(native_financials, years, "InsuranceExpenseRatio", is_ratio=True)
    insurance_combined_ratio = _insurance_filing_series(native_financials, years, "InsuranceCombinedRatio", is_ratio=True)
    insurance_prior_year_development = _insurance_filing_series(
        native_financials, years, "InsurancePriorYearReserveDevelopment", is_ratio=True,
    )
    insurance_underwriting_income = _insurance_filing_series(native_financials, years, "InsuranceUnderwritingIncome")
    insurance_net_investment_income = _insurance_filing_series(native_financials, years, "InsuranceNetInvestmentIncome")
    insurance_invested_assets = _company_fact_series(native_financials, years, "Investments")
    insurance_reserves_beginning = _insurance_filing_series(native_financials, years, "InsuranceUnpaidLossReservesBeginning")
    insurance_losses_incurred_reserve = _insurance_filing_series(native_financials, years, "InsuranceLossesIncurredForReserveRollforward")
    insurance_losses_paid_raw = _insurance_filing_series(native_financials, years, "InsuranceLossesPaidForReserveRollforward")
    insurance_losses_paid_reserve = [
        _line(
            abs(line["value"]) if line["value"] is not None else None,
            source=line["source"],
            confidence=line["confidence"],
            method="filed_loss_payment_outflow_shown_as_positive_claims_paid" if line["value"] is not None else line["method"],
            concept=line.get("concept"),
            sources=line.get("sources", []),
        )
        for line in insurance_losses_paid_raw
    ]
    insurance_reserve_other_changes = _insurance_filing_series(native_financials, years, "InsuranceReserveOtherChanges")
    insurance_unpaid_loss_reserves = _insurance_filing_series(native_financials, years, "InsuranceUnpaidLossReserves")
    insurance_reinsurance_recoverable = _insurance_filing_series(native_financials, years, "InsuranceReinsuranceRecoverable")
    insurance_gross_loss_reserves = _insurance_filing_series(native_financials, years, "InsuranceGrossLossReserves")
    insurance_other_operations_pretax = _insurance_filing_series(native_financials, years, "InsuranceOtherOperationsPretaxIncome")
    insurance_statutory_surplus = _insurance_filing_series(native_financials, years, "InsuranceStatutoryCapitalSurplus")
    insurance_minimum_statutory_capital = _insurance_filing_series(native_financials, years, "InsuranceMinimumStatutoryCapital")
    insurance_common_equity: List[Dict[str, Any]] = []
    insurance_common_distributions: List[Dict[str, Any]] = []
    insurance_other_pretax_adjustments: List[Dict[str, Any]] = []
    insurance_reserve_rollforward_check: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        book_line = book_value[idx]
        preferred_line = preferred_equity[idx]
        nci_line = non_controlling_interest[idx]
        insurance_common_equity.append(_common_equity_line(book_line, preferred_line, nci_line))

        dividend_line = dividends_paid[idx]
        repurchase_line = bank_buybacks[idx]
        if dividend_line["value"] is not None:
            dividend_line = {**dividend_line, "value": abs(dividend_line["value"])}
        if repurchase_line["value"] is not None:
            repurchase_line = {**repurchase_line, "value": abs(repurchase_line["value"])}
        insurance_common_distributions.append(_sum_lines(
            dividend_line,
            repurchase_line,
            method="common_dividends_plus_common_stock_repurchases",
            concept="common_equity_distributions",
        ))

        pretax_components = (
            pretax[idx],
            insurance_underwriting_income[idx],
            insurance_net_investment_income[idx],
            insurance_other_operations_pretax[idx],
        )
        if all(line["value"] is not None for line in pretax_components):
            insurance_other_pretax_adjustments.append(_line(
                pretax_components[0]["value"]
                - pretax_components[1]["value"]
                - pretax_components[2]["value"]
                - pretax_components[3]["value"],
                source="derived",
                confidence=min(line["confidence"] for line in pretax_components),
                method="reported_pretax_less_p_and_c_underwriting_investment_and_other_operations_income",
                concept="other_pretax_adjustments",
                sources=_source_records(*pretax_components),
            ))
        else:
            insurance_other_pretax_adjustments.append(_line(
                None,
                source="ambiguous" if any(line["source"] == "ambiguous" for line in pretax_components) else "missing",
                confidence=0.0,
                method="missing_insurance_pretax_reconciliation_inputs",
                concept="other_pretax_adjustments",
                sources=_source_records(*pretax_components),
            ))

        reserve_components = (
            insurance_reserves_beginning[idx],
            insurance_losses_incurred_reserve[idx],
            insurance_losses_paid_reserve[idx],
            insurance_reserve_other_changes[idx],
            insurance_unpaid_loss_reserves[idx],
        )
        if all(line["value"] is not None for line in reserve_components):
            insurance_reserve_rollforward_check.append(_line(
                reserve_components[0]["value"]
                + reserve_components[1]["value"]
                - reserve_components[2]["value"]
                + reserve_components[3]["value"]
                - reserve_components[4]["value"],
                source="derived",
                confidence=min(line["confidence"] for line in reserve_components),
                method="opening_reserves_plus_incurred_less_paid_plus_other_changes_less_ending_reserves",
                concept="loss_reserve_rollforward_check",
                sources=_source_records(*reserve_components),
            ))
        else:
            insurance_reserve_rollforward_check.append(_line(
                None,
                source="ambiguous" if any(line["source"] == "ambiguous" for line in reserve_components) else "missing",
                confidence=0.0,
                method="incomplete_loss_reserve_rollforward_inputs",
                concept="loss_reserve_rollforward_check",
                sources=_source_records(*reserve_components),
            ))

    insurance_series: Dict[str, List[Dict[str, Any]]] = {
        "net_premiums_written": insurance_premiums_written,
        "net_premiums_earned": insurance_premiums_earned,
        "losses_and_lae": insurance_losses_and_lae,
        "acquisition_expenses": insurance_acquisition_expenses,
        "general_operating_expenses": insurance_general_operating_expenses,
        "underwriting_expenses": insurance_underwriting_expenses,
        "loss_ratio": insurance_loss_ratio,
        "expense_ratio": insurance_expense_ratio,
        "combined_ratio": insurance_combined_ratio,
        "prior_year_reserve_development": insurance_prior_year_development,
        "underwriting_income": insurance_underwriting_income,
        "net_investment_income": insurance_net_investment_income,
        "invested_assets": insurance_invested_assets,
        "unpaid_loss_reserves_beginning": insurance_reserves_beginning,
        "losses_incurred_for_reserve_rollforward": insurance_losses_incurred_reserve,
        "losses_paid_for_reserve_rollforward": insurance_losses_paid_reserve,
        "reserve_other_changes": insurance_reserve_other_changes,
        "unpaid_loss_reserves": insurance_unpaid_loss_reserves,
        "reinsurance_recoverable": insurance_reinsurance_recoverable,
        "gross_loss_reserves": insurance_gross_loss_reserves,
        "reserve_rollforward_check": insurance_reserve_rollforward_check,
        "other_operations_pretax_income": insurance_other_operations_pretax,
        "statutory_capital_surplus": insurance_statutory_surplus,
        "minimum_statutory_capital": insurance_minimum_statutory_capital,
        "common_equity": insurance_common_equity,
        "common_equity_distributions": insurance_common_distributions,
        "diluted_shares": shares,
        "net_income": net_income,
        "tax_rate": tax_rate,
        "reported_pretax_income": pretax,
        "other_pretax_adjustments": insurance_other_pretax_adjustments,
    }

    reit_net_income_exact = net_income
    reit_nareit_bridge_net_income = _reit_filing_series(native_financials, years, "ReitNareitBridgeNetIncome")
    reit_real_estate_depreciation = _reit_filing_series(native_financials, years, "ReitRealEstateDepreciation")
    reit_disposition_gains = _reit_filing_series(native_financials, years, "ReitDispositionGainsNareitAdjustment")
    reit_nareit_nci = _reit_filing_series(native_financials, years, "ReitNciNareitAdjustment")
    reit_nareit_unconsolidated = _reit_filing_series(native_financials, years, "ReitUnconsolidatedNareitAdjustment")
    reit_nareit_ffo = _reit_filing_series(native_financials, years, "ReitNareitFFO")
    reit_modified_fx = _reit_filing_series(native_financials, years, "ReitModifiedFfoFxAdjustment")
    reit_modified_tax = _reit_filing_series(native_financials, years, "ReitModifiedFfoDeferredTaxAdjustment")
    reit_modified_current_tax_reported = _reit_filing_series(native_financials, years, "ReitModifiedFfoCurrentTaxAdjustment")
    reit_modified_nci = _reit_filing_series(native_financials, years, "ReitModifiedFfoNciAdjustment")
    reit_modified_unconsolidated = _reit_filing_series(native_financials, years, "ReitModifiedFfoUnconsolidatedAdjustment")
    reit_modified_ffo = _reit_filing_series(native_financials, years, "ReitModifiedFFO")
    reit_modified_current_tax: List[Dict[str, Any]] = []
    reit_modified_nci_resolved: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        current_tax_line = reit_modified_current_tax_reported[idx]
        nci_line = reit_modified_nci[idx]
        if current_tax_line["value"] is None and nci_line["value"] is not None:
            known = [
                reit_nareit_ffo[idx], reit_modified_fx[idx], reit_modified_tax[idx],
                nci_line, reit_modified_unconsolidated[idx],
            ]
            known_total = _sum_many_lines(known, method="sum_of_reported_modified_ffo_components", concept="reported_modified_ffo_components")
            current_tax_line = _difference_line(reit_modified_ffo[idx], known_total, method="reported_modified_ffo_less_other_disclosed_adjustments", concept="reit_modified_ffo_current_tax_adjustment")
        elif nci_line["value"] is None and current_tax_line["value"] is not None:
            known = [
                reit_nareit_ffo[idx], reit_modified_fx[idx], reit_modified_tax[idx],
                current_tax_line, reit_modified_unconsolidated[idx],
            ]
            known_total = _sum_many_lines(known, method="sum_of_reported_modified_ffo_components", concept="reported_modified_ffo_components")
            nci_line = _difference_line(reit_modified_ffo[idx], known_total, method="reported_modified_ffo_less_other_disclosed_adjustments", concept="reit_modified_ffo_nci_adjustment")
        reit_modified_current_tax.append(current_tax_line)
        reit_modified_nci_resolved.append(nci_line)
    reit_core_dispositions = _reit_filing_series(native_financials, years, "ReitCoreFfoDispositionAdjustment")
    reit_core_tax = _reit_filing_series(native_financials, years, "ReitCoreFfoTaxAdjustment")
    reit_core_debt = _reit_filing_series(native_financials, years, "ReitCoreFfoDebtExtinguishmentAdjustment")
    reit_core_nci = _reit_filing_series(native_financials, years, "ReitCoreFfoNciAdjustment")
    reit_core_unconsolidated = _reit_filing_series(native_financials, years, "ReitCoreFfoUnconsolidatedAdjustment")
    reit_core_ffo = _reit_filing_series(native_financials, years, "ReitCoreFFO")
    reit_tenant_improvements = _reit_filing_series(native_financials, years, "ReitTenantImprovementsAndLeaseCommissions")
    reit_property_improvements = _reit_filing_series(native_financials, years, "ReitPropertyImprovements")
    reit_recurring_capex = [
        _sum_lines(
            reit_tenant_improvements[idx],
            reit_property_improvements[idx],
            method="tenant_improvements_and_lease_commissions_plus_property_improvements",
            concept="reit_recurring_capex_proxy",
        )
        for idx in range(len(years))
    ]
    reit_analyst_affo = [
        _difference_line(reit_core_ffo[idx], reit_recurring_capex[idx], method="core_ffo_less_tenant_improvements_and_property_improvements", concept="reit_analyst_affo")
        for idx in range(len(years))
    ]
    reit_same_store_net_effective = _reit_filing_series(native_financials, years, "ReitSameStoreNOINetEffective")
    reit_same_store_cash = _reit_filing_series(native_financials, years, "ReitSameStoreNOICash")
    reit_occupancy = _reit_filing_series(native_financials, years, "ReitOccupancy", is_ratio=True)
    reit_real_estate_segment_noi = _reit_filing_series(native_financials, years, "ReitRealEstateSegmentNOI")
    reit_strategic_capital_segment_noi = _reit_filing_series(native_financials, years, "ReitStrategicCapitalSegmentNOI")
    reit_common_distributions = _reit_filing_series(native_financials, years, "ReitCommonDistributions")
    reit_same_store_growth: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        if idx > 0 and reit_same_store_net_effective[idx]["value"] is not None and reit_same_store_net_effective[idx - 1]["value"] is not None:
            prior = reit_same_store_net_effective[idx - 1]
            current = reit_same_store_net_effective[idx]
            prior_accessions = {source.get("accession") for source in prior.get("sources", []) if source.get("accession")}
            current_accessions = {source.get("accession") for source in current.get("sources", []) if source.get("accession")}
            if float(prior["value"]) > 0 and prior_accessions and prior_accessions == current_accessions:
                reit_same_store_growth.append(_line(
                    float(current["value"]) / float(prior["value"]) - 1.0,
                    source="derived",
                    confidence=min(current["confidence"], prior["confidence"]),
                    method="filed_same_store_noi_current_year_over_prior_year_less_one",
                    concept="reit_same_store_noi_growth",
                    sources=_source_records(current, prior),
                ))
                continue
        reit_same_store_growth.append(_line(None, source="missing", confidence=0.0, method=f"missing_filed_same_store_noi_growth_fy{year}", concept="reit_same_store_noi_growth"))

    reit_series: Dict[str, List[Dict[str, Any]]] = {
        "net_income_available_to_common": reit_net_income_exact,
        "nareit_bridge_net_income": reit_nareit_bridge_net_income,
        "real_estate_depreciation": reit_real_estate_depreciation,
        "disposition_gains_nareit_adjustment": reit_disposition_gains,
        "nci_nareit_adjustment": reit_nareit_nci,
        "unconsolidated_nareit_adjustment": reit_nareit_unconsolidated,
        "nareit_ffo": reit_nareit_ffo,
        "modified_ffo_fx_adjustment": reit_modified_fx,
        "modified_ffo_deferred_tax_adjustment": reit_modified_tax,
        "modified_ffo_current_tax_adjustment": reit_modified_current_tax,
        "modified_ffo_nci_adjustment": reit_modified_nci_resolved,
        "modified_ffo_unconsolidated_adjustment": reit_modified_unconsolidated,
        "modified_ffo": reit_modified_ffo,
        "core_ffo_disposition_adjustment": reit_core_dispositions,
        "core_ffo_tax_adjustment": reit_core_tax,
        "core_ffo_debt_extinguishment_adjustment": reit_core_debt,
        "core_ffo_nci_adjustment": reit_core_nci,
        "core_ffo_unconsolidated_adjustment": reit_core_unconsolidated,
        "core_ffo": reit_core_ffo,
        "tenant_improvements_and_lease_commissions": reit_tenant_improvements,
        "property_improvements": reit_property_improvements,
        "recurring_capex": reit_recurring_capex,
        "analyst_affo": reit_analyst_affo,
        "same_store_noi_net_effective": reit_same_store_net_effective,
        "same_store_noi_cash": reit_same_store_cash,
        "same_store_noi_growth": reit_same_store_growth,
        "occupancy": reit_occupancy,
        "real_estate_segment_noi": reit_real_estate_segment_noi,
        "strategic_capital_segment_noi": reit_strategic_capital_segment_noi,
        "common_distributions": reit_common_distributions,
    }

    asset_manager_aum = _asset_manager_filing_series(native_financials, years, "AssetManagerAum")
    asset_manager_beginning_aum = _asset_manager_beginning_aum_series(native_financials, years)
    asset_manager_base_fees = _asset_manager_filing_series(native_financials, years, "AssetManagerBaseFees")
    asset_manager_average_aum = _asset_manager_average_aum_series(years, asset_manager_beginning_aum, asset_manager_aum)
    asset_manager_base_fee_yield = _asset_manager_base_fee_yield_series(asset_manager_base_fees, asset_manager_average_aum)
    asset_manager_revenue_components: Dict[str, List[Dict[str, Any]]] = {
        "base_fees": asset_manager_base_fees,
        "performance_fees": _asset_manager_filing_series(native_financials, years, "AssetManagerPerformanceFees"),
        "capital_allocation_income": _asset_manager_filing_series(native_financials, years, "AssetManagerCapitalAllocationIncome"),
        "securities_lending_revenue": _asset_manager_filing_series(native_financials, years, "AssetManagerSecuritiesLendingRevenue"),
        "technology_revenue": _asset_manager_filing_series(native_financials, years, "AssetManagerTechnologyRevenue"),
        "distribution_revenue": _asset_manager_filing_series(native_financials, years, "AssetManagerDistributionRevenue"),
        "administrative_other_revenue": _asset_manager_filing_series(native_financials, years, "AssetManagerAdministrativeOtherRevenue"),
        "other_revenue": _asset_manager_filing_series(native_financials, years, "AssetManagerOtherRevenue"),
    }
    asset_manager_unmapped_revenue = _asset_manager_unmapped_revenue_series(revenue, asset_manager_revenue_components)
    asset_manager_series: Dict[str, List[Dict[str, Any]]] = {
        "aum": asset_manager_aum,
        "beginning_aum": asset_manager_beginning_aum,
        "average_aum": asset_manager_average_aum,
        "net_flows": _asset_manager_filing_series(native_financials, years, "AssetManagerNetFlows"),
        "realizations": _asset_manager_filing_series(native_financials, years, "AssetManagerRealizations"),
        "acquisitions": _asset_manager_filing_series(native_financials, years, "AssetManagerAcquisitions"),
        "market_change": _asset_manager_filing_series(native_financials, years, "AssetManagerMarketChange"),
        "fx_change": _asset_manager_filing_series(native_financials, years, "AssetManagerFxChange"),
        "scope_change": _asset_manager_filing_series(native_financials, years, "AssetManagerScopeChange"),
        "depreciation": _asset_manager_filing_series(native_financials, years, "AssetManagerDepreciation"),
        "acquisition_amortization": _asset_manager_filing_series(native_financials, years, "AssetManagerAcquisitionAmortization"),
        "working_capital_change": _asset_manager_filing_series(native_financials, years, "AssetManagerWorkingCapitalChange"),
        "base_fees": asset_manager_base_fees,
        "base_fee_yield": asset_manager_base_fee_yield,
        "capital_allocation_income": asset_manager_revenue_components["capital_allocation_income"],
        "performance_fees": asset_manager_revenue_components["performance_fees"],
        "securities_lending_revenue": asset_manager_revenue_components["securities_lending_revenue"],
        "technology_revenue": asset_manager_revenue_components["technology_revenue"],
        "distribution_revenue": asset_manager_revenue_components["distribution_revenue"],
        "administrative_other_revenue": asset_manager_revenue_components["administrative_other_revenue"],
        "other_revenue": asset_manager_revenue_components["other_revenue"],
        "unmapped_revenue": asset_manager_unmapped_revenue,
    }
    has_asset_manager_filing_facts = bool(native_financials.get("asset_management_filing_facts"))

    telecom_concepts = {
        "capital_expenditures": "TelecomCapitalExpenditures",
        "working_capital_change": "TelecomWorkingCapitalChange",
        "interest_bearing_debt": "TelecomInterestBearingDebt",
        "cost_of_debt": "TelecomCostOfDebt",
        "wireless_subscribers": "TelecomWirelessSubscribers",
        "postpaid_subscribers": "TelecomPostpaidSubscribers",
        "postpaid_phone_subscribers": "TelecomPostpaidPhoneSubscribers",
        "prepaid_subscribers": "TelecomPrepaidSubscribers",
        "reseller_subscribers": "TelecomResellerSubscribers",
        "wireless_net_additions": "TelecomWirelessNetAdditions",
        "postpaid_phone_net_additions": "TelecomPostpaidPhoneNetAdditions",
        "postpaid_churn": "TelecomPostpaidChurn",
        "postpaid_phone_churn": "TelecomPostpaidPhoneChurn",
        "mobility_revenue": "TelecomMobilityRevenue",
        "mobility_service_revenue": "TelecomMobilityServiceRevenue",
        "mobility_equipment_revenue": "TelecomMobilityEquipmentRevenue",
        "mobility_operating_income": "TelecomMobilityOperatingIncome",
        "mobility_depreciation": "TelecomMobilityDepreciation",
        "business_wireline_revenue": "TelecomBusinessWirelineRevenue",
        "business_wireline_operating_income": "TelecomBusinessWirelineOperatingIncome",
        "business_wireline_depreciation": "TelecomBusinessWirelineDepreciation",
        "consumer_wireline_revenue": "TelecomConsumerWirelineRevenue",
        "consumer_broadband_revenue": "TelecomConsumerWirelineBroadbandRevenue",
        "consumer_wireline_operating_income": "TelecomConsumerWirelineOperatingIncome",
        "consumer_wireline_depreciation": "TelecomConsumerWirelineDepreciation",
        "broadband_connections": "TelecomBroadbandConnections",
        "fiber_broadband_connections": "TelecomFiberBroadbandConnections",
        "broadband_net_additions": "TelecomBroadbandNetAdditions",
        "fiber_broadband_net_additions": "TelecomFiberBroadbandNetAdditions",
        "latin_america_revenue": "TelecomLatinAmericaRevenue",
        "latin_america_operating_income": "TelecomLatinAmericaOperatingIncome",
        "communications_revenue": "TelecomCommunicationsRevenue",
        "communications_operating_income": "TelecomCommunicationsOperatingIncome",
    }
    telecom_series = {
        field: _telecom_filing_series(native_financials, years, concept)
        for field, concept in telecom_concepts.items()
    }
    has_telecom_filing_facts = bool(native_financials.get("telecom_filing_facts"))

    mortgage_reit_concepts = {
        "investment_securities_fair_value": "MortgageReitInvestmentSecuritiesFairValue",
        "total_assets": "MortgageReitTotalAssets",
        "repo_and_other_debt": "MortgageReitRepoAndOtherDebt",
        "total_liabilities": "MortgageReitTotalLiabilities",
        "total_stockholders_equity": "MortgageReitTotalStockholdersEquity",
        "net_book_value_per_common_share": "MortgageReitNetBookValuePerCommonShare",
        "tangible_book_value_per_common_share": "MortgageReitTangibleBookValuePerCommonShare",
        "period_end_common_shares": "MortgageReitPeriodEndCommonShares",
        "preferred_equity_carrying_value": "MortgageReitPreferredEquityCarryingValue",
        "preferred_equity_liquidation_preference": "MortgageReitPreferredEquityLiquidationPreference",
        "gaap_interest_income": "MortgageReitGAAPInterestIncome",
        "gaap_interest_expense": "MortgageReitGAAPInterestExpense",
        "gaap_net_interest_income": "MortgageReitGAAPNetInterestIncome",
        "economic_interest_income": "MortgageReitEconomicInterestIncome",
        "economic_interest_expense": "MortgageReitEconomicInterestExpense",
        "other_gain_net": "MortgageReitOtherGainNet",
        "operating_expenses": "MortgageReitOperatingExpenses",
        "net_income": "MortgageReitNetIncome",
        "preferred_dividends": "MortgageReitPreferredDividends",
        "net_income_available_to_common": "MortgageReitNetIncomeAvailableToCommon",
        "other_comprehensive_income": "MortgageReitOtherComprehensiveIncome",
        "comprehensive_income": "MortgageReitComprehensiveIncome",
        "comprehensive_income_available_to_common": "MortgageReitComprehensiveIncomeAvailableToCommon",
        "common_dividends_per_share": "MortgageReitCommonDividendsPerShareDeclared",
        "average_investment_securities_at_cost": "MortgageReitAverageInvestmentSecuritiesAtCost",
        "average_tba_dollar_roll_position_at_cost": "MortgageReitAverageTbaDollarRollPositionAtCost",
        "average_total_assets_fair_value": "MortgageReitAverageTotalAssetsFairValue",
        "average_repo_borrowings": "MortgageReitAverageRepoBorrowings",
        "average_mortgage_borrowings": "MortgageReitAverageMortgageBorrowings",
        "average_stockholders_equity": "MortgageReitAverageStockholdersEquity",
        "average_at_risk_leverage": "MortgageReitAverageAtRiskLeverage",
        "period_end_at_risk_leverage": "MortgageReitPeriodEndAtRiskLeverage",
        "economic_return_on_tangible_common_equity": "MortgageReitEconomicReturnOnTangibleCommonEquity",
        "expenses_pct_average_assets": "MortgageReitExpensesPctAverageAssets",
        "average_asset_yield": "MortgageReitAverageAssetYield",
        "average_aggregate_cost_of_funds": "MortgageReitAverageAggregateCostOfFunds",
        "average_net_interest_spread": "MortgageReitAverageNetInterestSpread",
        "average_swap_notional": "MortgageReitAverageSwapNotional",
        "average_swap_ratio": "MortgageReitAverageSwapRatio",
        "average_swap_net_pay_rate": "MortgageReitAverageSwapNetPayRate",
    }
    mortgage_reit_series = {
        field: _mortgage_reit_filing_series(native_financials, years, concept)
        for field, concept in mortgage_reit_concepts.items()
    }
    has_mortgage_reit_filing_facts = bool(native_financials.get("mortgage_reit_filing_facts"))

    energy_concepts = {
        "weighted_average_diluted_shares": "EnergyWeightedAverageDilutedShares",
        "current_debt": "EnergyCurrentDebt",
        "long_term_debt": "EnergyLongTermDebt",
        "interest_bearing_debt": "EnergyInterestBearingDebt",
        "crude_oil_production": "EnergyTotalCrudeOilProduction",
        "ngl_production": "EnergyTotalNGLProduction",
        "bitumen_production": "EnergyBitumenProduction",
        "synthetic_oil_production": "EnergySyntheticOilProduction",
        "liquids_production": "EnergyTotalLiquidsProduction",
        "natural_gas_production_available_for_sale": "EnergyTotalNaturalGasProduction",
        "oil_equivalent_production": "EnergyOilEquivalentProduction",
        "average_crude_price": "EnergyTotalCrudePrice",
        "average_ngl_price": "EnergyTotalNGLPrice",
        "average_bitumen_price": "EnergyTotalBitumenPrice",
        "average_synthetic_oil_price": "EnergyTotalSyntheticOilPrice",
        "average_natural_gas_price": "EnergyTotalNaturalGasPrice",
        "average_production_cost_per_oil_equivalent_barrel": "EnergyProductionCostPerOilEquivalentBarrel",
        "proved_oil_equivalent_reserves": "EnergyTotalProvedOilEquivalentReserves",
        "proved_developed_oil_equivalent_reserves": "EnergyDevelopedOilEquivalentReserves",
        "proved_undeveloped_oil_equivalent_reserves": "EnergyUndevelopedOilEquivalentReserves",
        "upstream_earnings_gaap": "EnergyUpstreamEarningsGAAP",
        "energy_products_earnings_gaap": "EnergyProductsEarningsGAAP",
        "chemical_products_earnings_gaap": "EnergyChemicalProductsEarningsGAAP",
        "specialty_products_earnings_gaap": "EnergySpecialtyProductsEarningsGAAP",
        "corporate_financing_earnings_gaap": "EnergyCorporateFinancingEarningsGAAP",
        "upstream_depreciation_and_depletion": "EnergyUpstreamDandD",
        "energy_products_depreciation_and_depletion": "EnergyEnergyProductsDandD",
        "chemical_products_depreciation_and_depletion": "EnergyChemicalProductsDandD",
        "specialty_products_depreciation_and_depletion": "EnergySpecialtyProductsDandD",
        "upstream_ppe_additions_including_noncash": "EnergyUpstreamPPEAdditions",
        "energy_products_ppe_additions_including_noncash": "EnergyEnergyProductsPPEAdditions",
        "chemical_products_ppe_additions_including_noncash": "EnergyChemicalProductsPPEAdditions",
        "specialty_products_ppe_additions_including_noncash": "EnergySpecialtyProductsPPEAdditions",
        "cash_capex": "EnergyCashCapex",
        "operating_working_capital_investment": "EnergyWorkingCapitalInvestment",
        "corporate_interest_revenue": "EnergyCorporateInterestRevenue",
        "brent_2026_earnings_sensitivity": "Energy2026BrentEarningsSensitivity",
        "henry_hub_2026_earnings_sensitivity": "Energy2026HenryHubEarningsSensitivity",
        "ttf_2026_earnings_sensitivity": "Energy2026TTFEarningsSensitivity",
    }
    energy_series = {
        field: _energy_filing_series(native_financials, years, concept)
        for field, concept in energy_concepts.items()
        if not concept.startswith("Energy2026")
    }
    energy_sensitivity_series = {
        field: _energy_filing_series(native_financials, [2026], concept)[0]
        for field, concept in energy_concepts.items()
        if concept.startswith("Energy2026")
    }
    has_energy_filing_facts = bool(native_financials.get("energy_filing_facts"))
    pharma_facts = native_financials.get("pharma_filing_facts")
    pharma_facts = pharma_facts if isinstance(pharma_facts, list) else []
    has_pharma_filing_facts = bool(pharma_facts)

    annual = []
    for idx, year in enumerate(years):
        bank_lines = {field: series[idx] for field, series in bank_series.items()}
        is_bank_data_available = bank_lines["deposits"]["value"] is not None or bank_lines["loans_and_leases"]["value"] is not None
        insurance_lines = {field: series[idx] for field, series in insurance_series.items()}
        is_insurance_data_available = (
            insurance_lines["net_premiums_written"]["value"] is not None
            or insurance_lines["net_premiums_earned"]["value"] is not None
        )
        reit_lines = {field: series[idx] for field, series in reit_series.items()}
        is_reit_data_available = reit_lines["nareit_ffo"]["value"] is not None or reit_lines["core_ffo"]["value"] is not None
        asset_manager_lines = {field: series[idx] for field, series in asset_manager_series.items()}
        telecom_lines = {field: series[idx] for field, series in telecom_series.items()}
        mortgage_reit_lines = {field: series[idx] for field, series in mortgage_reit_series.items()}
        energy_lines = {field: series[idx] for field, series in energy_series.items()}
        for field in (
            "brent_2026_earnings_sensitivity", "henry_hub_2026_earnings_sensitivity", "ttf_2026_earnings_sensitivity",
        ):
            energy_lines[field] = energy_sensitivity_series[field] if year == years[-1] else _line(
                None, source="missing", confidence=0.0, method="forward_sensitivity_available_only_for_latest_base_year",
                concept=energy_concepts[field],
            )
        pharma_products = []
        pharma_patents = []
        pharma_total_revenue = _line(
            None, source="missing", confidence=0.0, method="missing_filed_pfe_product_table_total", concept="reported_total_revenue",
        )
        if has_pharma_filing_facts:
            year_product_facts = [fact for fact in pharma_facts if isinstance(fact, dict)
                and fact.get("metric") == "product_revenue" and _to_number(fact.get("fiscal_year")) == year]
            for fact in year_product_facts:
                pharma_products.append({
                    "product_name": str(fact.get("product_name") or ""),
                    "indication": fact.get("indication"),
                    "revenue": _pharma_filing_line(fact),
                })
            total_revenue_fact = next((fact for fact in pharma_facts if isinstance(fact, dict)
                and fact.get("metric") == "reported_total_revenue" and _to_number(fact.get("fiscal_year")) == year), None)
            if total_revenue_fact is not None:
                pharma_total_revenue = _pharma_filing_line(total_revenue_fact)
            if year == years[-1]:
                for fact in pharma_facts:
                    if not isinstance(fact, dict) or fact.get("metric") not in {
                        "basic_patent_expiration_year", "pending_patent_term_extension_year",
                    }:
                        continue
                    pharma_patents.append({
                        "product_name": str(fact.get("product_name") or ""),
                        "region": str(fact.get("region") or ""),
                        "metric": str(fact.get("metric") or ""),
                        "year": _pharma_filing_line(fact),
                        "reported_text": str(fact.get("reported_text") or ""),
                    })
        pharma_marketable_fact = next((fact for fact in pharma_facts if isinstance(fact, dict)
            and fact.get("metric") == "marketable_securities" and _to_number(fact.get("fiscal_year")) == year), None)
        pharma_marketable_securities = _pharma_filing_line(pharma_marketable_fact) if pharma_marketable_fact else marketable_securities[idx]
        canonical_revenue = pharma_total_revenue if has_pharma_filing_facts and pharma_total_revenue.get("value") is not None else revenue[idx]
        annual_record = {
            "year": year,
            "revenue": canonical_revenue,
            "cost_of_revenue": cost_of_revenue[idx],
            "gross_profit": gross_profit[idx],
            "ebit": ebit[idx],
            "ebitda": ebitda[idx],
            "interest_expense": interest[idx],
            "income_tax_expense": tax[idx],
            "net_income": net_income[idx],
            "depreciation": depreciation[idx],
            "stock_based_comp": stock_based_comp[idx],
            "cfo": cfo[idx],
            "capex": capex[idx],
            "cash": cash[idx],
            "marketable_securities": pharma_marketable_securities,
            "marketable_securities_current": marketable_securities_current[idx],
            "marketable_securities_noncurrent": marketable_securities_noncurrent[idx],
            "long_term_debt_current": long_term_debt_current[idx],
            "commercial_paper": commercial_paper[idx],
            "current_debt": debt_current[idx],
            "long_term_debt": debt_long[idx],
            "debt": debt[idx],
            "operating_lease_liability_current": operating_lease_current[idx],
            "operating_lease_liability_noncurrent": operating_lease_noncurrent[idx],
            "lease_liabilities": lease_liabilities[idx],
            "book_value": book_value[idx],
            "accounts_receivable": accounts_receivable[idx],
            "inventory": inventory[idx],
            "accounts_payable": accounts_payable[idx],
            "total_assets": total_assets[idx],
            "total_liabilities": total_liabilities[idx],
            "retained_earnings": retained_earnings[idx],
            "dividends_paid": dividends_paid[idx],
            "non_controlling_interest": non_controlling_interest[idx],
            "preferred_equity": preferred_equity[idx],
            "total_current_assets": total_current_assets[idx],
            "other_current_assets": other_current_assets[idx],
            "ppe_net": ppe_net[idx],
            "other_assets": other_assets[idx],
            "other_liabilities": other_liabilities[idx],
            "total_current_liabilities": total_current_liabilities[idx],
            "other_current_liabilities": other_current_liabilities[idx],
            "deferred_revenue": deferred_revenue[idx],
            "research_and_development": research_and_development[idx],
            "general_and_administrative": general_and_administrative[idx],
            "marketing": marketing[idx],
            "rent": rent[idx],
            "bad_debt": bad_debt[idx],
            "other_operating_expenses": other_operating_expenses[idx],
            "deferred_tax": deferred_tax[idx],
            "other_non_cash": other_non_cash[idx],
            "nwc_change": nwc_change[idx],
            "operating_net_working_capital": operating_net_working_capital[idx],
            "fcff": fcff[idx],
            "balance_sheet_check": balance_sheet_check[idx],
            "tax_rate": tax_rate[idx],
            "shares": shares[idx],
            "bank": bank_lines if is_bank_data_available else None,
            "insurance": insurance_lines if is_insurance_data_available else None,
            "reit": reit_lines if is_reit_data_available else None,
            "asset_manager": asset_manager_lines if has_asset_manager_filing_facts else None,
            "telecom": telecom_lines if has_telecom_filing_facts else None,
            "mortgage_reit": mortgage_reit_lines if has_mortgage_reit_filing_facts else None,
            "energy": energy_lines if has_energy_filing_facts else None,
            "pharma": {
                "products": pharma_products,
                "patents": pharma_patents,
                "reported_total_revenue": pharma_total_revenue,
            } if has_pharma_filing_facts else None,
        }
        annual.append(annual_record)
    source_facts = native_financials.get("source_facts")
    if isinstance(source_facts, list):
        for annual_record in annual:
            year = int(annual_record["year"])
            for name, line in annual_record.items():
                if name == "bank" and isinstance(line, dict):
                    for bank_line in line.values():
                        if isinstance(bank_line, dict):
                            _attach_sec_fact_metadata(bank_line, year, source_facts)
                            _attach_period_filing_metadata(
                                bank_line,
                                year,
                                source_filings,
                                str(market.get("currency") or native_financials.get("currency") or ""),
                            )
                elif name == "insurance" and isinstance(line, dict):
                    for insurance_line in line.values():
                        if isinstance(insurance_line, dict):
                            _attach_sec_fact_metadata(insurance_line, year, source_facts)
                            _attach_period_filing_metadata(
                                insurance_line,
                                year,
                                source_filings,
                                str(market.get("currency") or native_financials.get("currency") or ""),
                            )
                elif name == "reit" and isinstance(line, dict):
                    for reit_line in line.values():
                        if isinstance(reit_line, dict):
                            _attach_sec_fact_metadata(reit_line, year, source_facts)
                            _attach_period_filing_metadata(
                                reit_line,
                                year,
                                source_filings,
                                str(market.get("currency") or native_financials.get("currency") or ""),
                            )
                elif name == "asset_manager" and isinstance(line, dict):
                    for asset_manager_line in line.values():
                        if isinstance(asset_manager_line, dict):
                            _attach_period_filing_metadata(
                                asset_manager_line,
                                year,
                                source_filings,
                                str(market.get("currency") or native_financials.get("currency") or ""),
                            )
                elif name == "pharma":
                    continue
                elif name != "year" and isinstance(line, dict):
                    _attach_sec_fact_metadata(line, year, source_facts)
                    _attach_period_filing_metadata(
                        line,
                        year,
                        source_filings,
                        str(market.get("currency") or native_financials.get("currency") or ""),
                    )

    latest = annual[-1] if annual else None
    return {
        "currency": market.get("currency") or native_financials.get("currency"),
        "scale": "actual",
        "metadata": {
            "is_financial_institution": bool(native_financials.get("is_financial_institution")),
        },
        "years": years,
        "annual": annual,
        "latest": latest,
        "quality": {
            "has_revenue": bool(_latest(revenue)["value"]),
            "has_ebit": bool(_latest(ebit)["value"]),
            "has_capex": bool(_latest(capex)["value"]),
            "has_shares": bool(_latest(shares)["value"]),
        },
    }
