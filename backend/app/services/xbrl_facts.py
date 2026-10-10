"""Structured XBRL fact access for specialist disclosure extractors.

Specialist parsers historically read values out of filing HTML tables. Where a
disclosure is XBRL-tagged (note tables are facts in the filing instance), the
same value is available with exact provenance - concept, axis, member, period,
decimals - through edgartools' facts API. This module wraps that API in narrow
helpers: callers keep their narrative parsers as the fallback path and merge
XBRL rows over the values they parsed.

Everything here is pure except `load_xbrl_document` / `load_filing_xbrl`, which
perform the blocking XBRL parse on a worker thread and degrade to `None`.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger("sec-service")

_PARENTHETICAL_RE = re.compile(r"\([^)]*\)")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _axis_name(raw_key: str) -> str:
    """Turn a raw parquet dimension column name into a canonical axis QName.

    `dim_srt_StatementGeographicalAxis` -> `srt:StatementGeographicalAxis`.
    """
    return raw_key[len("dim_"):].replace("_", ":", 1)


async def load_xbrl_document(filing: Any) -> Any | None:
    """Parse `filing` into its XBRL document, or None when unavailable.

    Returns None when the filing carries no XBRL attachments or the parse
    fails; callers fall back to their narrative parser.
    """
    try:
        return await asyncio.to_thread(filing.xbrl)
    except Exception as exc:
        logger.warning(
            "XBRL facts unavailable for %s (%s)",
            getattr(filing, "accession_no", "unknown accession"),
            type(exc).__name__,
        )
        return None


async def load_filing_xbrl(
    company: Any,
    filing_record: Dict[str, Any],
    *,
    forms: Sequence[str] = ("10-K", "10-K/A"),
) -> Any | None:
    """Resolve `filing_record` to its parsed XBRL document (see above)."""
    accession = str(filing_record.get("accession_number") or "")
    if not accession:
        return None
    try:
        filings = await asyncio.to_thread(company.get_filings, form=list(forms))
        filing = await asyncio.to_thread(filings.get, accession)
    except Exception as exc:
        logger.warning(
            "XBRL filing lookup failed for %s/%s (%s)",
            getattr(company, "cik", "unknown CIK"),
            accession,
            type(exc).__name__,
        )
        return None
    return await load_xbrl_document(filing)


def query_fact_rows(
    xbrl: Any,
    *,
    concept: str,
    exact: bool = True,
    axis: Optional[str] = None,
    dimensionless: bool = False,
    fiscal_years: Optional[Iterable[int]] = None,
) -> List[Dict[str, Any]]:
    """Run one numeric facts query and return normalized, deduplicated rows.

    `axis` keeps facts carrying that dimension; `dimensionless=True` keeps
    facts without any dimension. `concept` with `exact=True` must be the full
    QName spelling ('us-gaap:Revenues'); otherwise it is a regex over concept
    spellings. Query failures log and return an empty list so enrichment never
    takes down the narrative path.
    """
    rows: List[Dict[str, Any]] = []
    years: List[Optional[int]] = list(fiscal_years) if fiscal_years is not None else [None]
    for year in years:
        try:
            query = xbrl.facts.query().by_concept(concept, exact=exact)
            if dimensionless:
                query = query.by_dimension(None)
            elif axis:
                query = query.by_dimension(axis)
            if year is not None:
                query = query.by_fiscal_year(year)
            raw_rows = query.execute()
        except Exception as exc:
            logger.warning(
                "XBRL fact query failed (%s%s, %s)",
                concept,
                f" year {year}" if year is not None else "",
                type(exc).__name__,
            )
            continue
        for raw in raw_rows:
            normalized = _normalize_fact_row(raw)
            if normalized is not None:
                rows.append(normalized)
    return dedupe_fact_rows(rows)


def dedupe_fact_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop repeated facts (same concept/member/period/value)."""
    seen: set[tuple] = set()
    unique: List[Dict[str, Any]] = []
    for row in rows:
        key = (
            row.get("concept"),
            row.get("member"),
            row.get("period_start"),
            row.get("period_end"),
            row.get("value"),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def dimension_matched(row: Dict[str, Any], dimensions: Dict[str, str]) -> bool:
    """True when the fact carries exactly the given dimension members."""
    row_dimensions = row.get("dimensions") or {}
    if set(row_dimensions) != set(dimensions):
        return False
    return all(row_dimensions.get(axis) == member for axis, member in dimensions.items())


def concept_facts(
    xbrl: Any,
    concept: str,
    *,
    dimensions: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """All numeric facts for one exact concept, optionally pinned to members.

    Without `dimensions` the query keeps dimensionless facts (the consolidated
    figure). With `dimensions` the fact must carry exactly those axes: a
    sibling context that adds another axis (a parent-company or segment
    duplicate) is excluded rather than silently overlaying a different scope.
    """
    try:
        query = xbrl.facts.query().by_concept(concept, exact=True)
        if dimensions:
            for axis, member in dimensions.items():
                query = query.by_dimension(axis, member)
        else:
            query = query.by_dimension(None)
        raw_rows = query.execute()
    except Exception as exc:
        logger.warning("XBRL fact query failed (%s, %s)", concept, type(exc).__name__)
        return []
    rows = [row for row in (_normalize_fact_row(raw) for raw in raw_rows) if row is not None]
    if dimensions is not None:
        rows = [row for row in rows if dimension_matched(row, dimensions)]
    return dedupe_fact_rows(rows)


def fact_year(row: Dict[str, Any]) -> Optional[int]:
    """The fiscal year a fact belongs to, from the fact itself."""
    fiscal_year = row.get("fiscal_year")
    if fiscal_year:
        return int(fiscal_year)
    for key in ("period_end", "period_instant", "period_start"):
        text = str(row.get(key) or "")
        if len(text) >= 4 and text[:4].isdigit():
            return int(text[:4])
    return None


def annual_lookup(rows: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """One preferred row per fiscal year (full-year durations first)."""
    lookup: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        year = fact_year(row)
        if year is None:
            continue
        current = lookup.get(year)
        if current is None or _prefer_annual_row(row, current):
            lookup[year] = row
    return lookup


def _prefer_annual_row(candidate: Dict[str, Any], current: Dict[str, Any]) -> bool:
    candidate_is_year = str(candidate.get("fiscal_period") or "") == "FY"
    current_is_year = str(current.get("fiscal_period") or "") == "FY"
    if candidate_is_year != current_is_year:
        return candidate_is_year
    return _decimals_rank(candidate) > _decimals_rank(current)


def _decimals_rank(row: Dict[str, Any]) -> int:
    try:
        return int(str(row.get("decimals")))
    except (TypeError, ValueError):
        return -999


def sum_lookups(lookups: Sequence[Dict[int, Dict[str, Any]]]) -> Dict[int, Dict[str, Any]]:
    """Sum the parts per year, keeping only years every part covers."""
    if not lookups:
        return {}
    years = set(lookups[0])
    for lookup in lookups[1:]:
        years &= set(lookup)
    summed: Dict[int, Dict[str, Any]] = {}
    for year in sorted(years):
        parts = [lookup[year] for lookup in lookups]
        summed[year] = {
            "concept": " + ".join(str(part.get("concept") or "") for part in parts),
            "value": round(sum(float(part.get("value") or 0.0) for part in parts), 6),
            "period_end": parts[0].get("period_end") or parts[0].get("period_instant"),
            "provenance": " + ".join(_fact_origin(part) for part in parts),
        }
    return summed


_SELECTOR_TRANSFORMS = {"x100": 100.0, "x-1": -1.0}

# Multipliers from an XBRL raw fact into the scale the narrative parsers store:
# dollar amounts are kept in millions/thousands/billions, ratios, percentages,
# per-share and count figures unscaled. A fact whose unit_scale is unknown
# keeps its parsed value (fail closed).
_UNIT_SCALE_FACTORS: Dict[str, float] = {
    "actual": 1.0,
    "units": 1.0,
    "shares": 1.0,
    "ratio": 1.0,
    "percent": 1.0,
    "thousands": 1e-3,
    "millions": 1e-6,
    "billions": 1e-9,
}


def _selector_note(part: Dict[str, Any], sample_row: Dict[str, Any]) -> str:
    note = _fact_origin(sample_row)
    transform = part.get("transform")
    if transform:
        note = f"{note} {transform}"
    return note


def metric_lookup(
    xbrl: Any,
    parts: Sequence[Dict[str, Any]],
) -> Dict[int, Dict[str, Any]]:
    """Combine a metric's selectors into {fiscal_year: overlay row}.

    `parts` is a list of selector dicts: `concept`, optional `dimensions`
    (exact axis->member map; omit for the consolidated figure), optional
    `transform` (`x100` for ratios the parser stores in percent points,
    `x-1` when the concept's sign convention is the inverse of the parsed
    presentation) and optional `unit`/`unit_scale` declarations that the
    overlay requires a matching fact to agree with. Part values sum. The
    metric is treated as unmapped (`{}`) as soon as one part has no facts, so
    a partial sum never ships.
    """
    part_lookups: List[Dict[int, Dict[str, Any]]] = []
    part_notes: List[str] = []
    for part in parts:
        rows = concept_facts(
            xbrl,
            str(part["concept"]),
            dimensions=dict(part.get("dimensions") or {}),
        )
        if not rows:
            return {}
        lookup = annual_lookup(rows)
        if not lookup:
            return {}
        transform = part.get("transform")
        if transform:
            try:
                factor = _SELECTOR_TRANSFORMS[str(transform)]
            except KeyError as exc:  # pragma: no cover - programming error
                raise ValueError(f"unknown selector transform {transform!r}") from exc
            lookup = {
                year: {**row, "value": float(row["value"]) * factor}
                for year, row in lookup.items()
            }
        part_lookups.append(lookup)
        part_notes.append(_selector_note(part, next(iter(lookup.values()))))
    combined = sum_lookups(part_lookups)
    note = " + ".join(part_notes)
    for row in combined.values():
        unit = parts[0].get("unit")
        unit_scale = parts[0].get("unit_scale")
        if unit:
            row["unit"] = unit
        if unit_scale:
            row["unit_scale"] = unit_scale
        row["provenance"] = note
    return combined


def build_metric_rows(
    xbrl: Any,
    selectors: Dict[str, Sequence[Dict[str, Any]]],
) -> Dict[str, Dict[int, Dict[str, Any]]]:
    """Run a `{metric: [selector parts]}` table against one XBRL document."""
    rows: Dict[str, Dict[int, Dict[str, Any]]] = {}
    for metric, parts in selectors.items():
        lookup = metric_lookup(xbrl, parts)
        if lookup:
            rows[metric] = lookup
    return rows


def normalize_metric_label(text: str) -> str:
    """Normalize a disclosure-row label for XBRL-vs-narrative matching.

    Drops parenthetical qualifiers ('Adcetris (e)', 'Enbrel (Outside the U.S.
    and Canada)') and punctuation so a narrative table row and the XBRL member
    label for the same line compare equal.
    """
    without_parentheticals = _PARENTHETICAL_RE.sub(" ", str(text or ""))
    return _NON_ALNUM_RE.sub(" ", without_parentheticals.lower()).strip()


def _fact_origin(row: Dict[str, Any]) -> str:
    if row.get("member"):
        return f"{row.get('concept')} @ {row.get('dimension')} ({row.get('member')})"
    return f"{row.get('concept')} (consolidated, no dimension)"


def fact_provenance(row: Dict[str, Any]) -> str:
    """Describe where an XBRL value came from, for `source_statement`."""
    if row.get("provenance"):
        return f"value from XBRL ({row['provenance']})"
    return f"value from XBRL {_fact_origin(row)}"


def _fact_unit_scale(row: Dict[str, Any]) -> float | None:
    """Multiplier converting an XBRL raw value into the fact's stored scale."""
    return _UNIT_SCALE_FACTORS.get(str(row.get("unit_scale") or "").strip().lower())


def overlay_xbrl_values(
    facts: List[Dict[str, Any]],
    rows: Dict[tuple, Dict[str, Any]],
    key_fn: Any,
) -> List[Dict[str, Any]]:
    """Overlay XBRL values on narrative facts, keyed per fact.

    `key_fn(fact)` returns the lookup key into `rows` (or None to skip the
    fact). A matched fact is re-sourced from the filing's tagged fact: the
    XBRL raw value is converted into the fact's own unit scale (the narrative
    parser stores amounts in millions, thousands or billions, ratios and
    per-share figures unscaled) and the fact keeps its `unit`/`unit_scale`
    labels, so canonical builders, readiness contracts and workbook mappers
    see the representation the parser produced. A row whose selector declares
    `unit`/`unit_scale` must agree with the fact's labels, and a fact whose
    `unit_scale` is missing from the conversion table keeps its narrative
    value - the overlay only replaces verified duplicates. The fact keeps its
    parsed `period_end` too: specialist parsers align it to the fiscal year
    the fact belongs to (year-shifted rows such as an insurance reserve
    beginning balance carry the report year, not the XBRL instant) and
    canonical builders select facts by that year.
    """
    overlayed: List[Dict[str, Any]] = []
    for fact in facts:
        key = key_fn(fact)
        row = rows.get(key) if key is not None else None
        factor = _fact_unit_scale(fact) if row is not None else None
        if row is None or factor is None:
            overlayed.append(fact)
            continue
        declared_unit = row.get("unit")
        declared_scale = row.get("unit_scale")
        if (declared_unit and str(declared_unit) != str(fact.get("unit"))) or (
            declared_scale and str(declared_scale) != str(fact.get("unit_scale"))
        ):
            overlayed.append(fact)
            continue
        overlayed.append({
            **fact,
            "value": float(row["value"]) * factor,
            "source_statement": f"{fact.get('source_statement')}; {fact_provenance(row)}",
        })
    return overlayed


def _normalize_fact_row(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    value = raw.get("numeric_value")
    if value is None:
        return None
    fiscal_year = raw.get("fiscal_year")
    dimensions = {
        _axis_name(str(key)): str(raw.get(key) or "")
        for key in raw
        if key.startswith("dim_")
    }
    return {
        "concept": raw.get("concept"),
        "member": raw.get("member"),
        "member_label": raw.get("label") or raw.get("dimension_member_label"),
        "dimension": raw.get("dimension"),
        "full_dimension_label": raw.get("full_dimension_label"),
        "dimensions": dimensions,
        "value": float(value),
        "decimals": raw.get("decimals"),
        "currency": raw.get("currency"),
        "unit_ref": raw.get("unit_ref"),
        "period_start": raw.get("period_start"),
        "period_end": raw.get("period_end"),
        "period_instant": raw.get("period_instant"),
        "fiscal_year": int(fiscal_year) if fiscal_year is not None else None,
        "fiscal_period": raw.get("fiscal_period"),
        "statement_role": raw.get("statement_role"),
        "fact_id": raw.get("fact_id"),
    }
