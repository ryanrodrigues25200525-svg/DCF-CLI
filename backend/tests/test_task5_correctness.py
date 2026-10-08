"""Task 5 RED: export + backend correctness sweep (#63, #44, #50, #53)."""

from __future__ import annotations

import asyncio
import time

from app.services.valuation.canonical import build_canonical_financials
from app.services.valuation.classifier import classify_company


def _src(accession="0000000000-26-000001"):
    return {"accession": accession, "filed": "2026-02-01"}


def _ready_line(value=1.0):
    return {
        "value": value,
        "source": "sec_native",
        "confidence": 0.9,
        "method": "test",
        "sources": [_src()],
    }


def _na_line():
    return {
        "value": None,
        "source": "not_applicable",
        "confidence": 0.9,
        "method": "test absence",
        "sources": [_src()],
    }


def _native_with_filings(form):
    return {
        "statements": {
            "income_statement": [{"concept": "Revenues", "FY 2024": 100.0}],
            "balance_sheet": [],
            "cashflow_statement": [],
        },
        "source_facts": [],
        "source_filings": [
            {
                "report_date": "2024-12-31",
                "form": form,
                "accession_number": "0000000000-26-000001",
                "filing_date": "2026-02-01",
            }
        ],
    }


def test_preferred_equity_absence_ignores_valueless_presented_row():
    """A presented preferred-stock row with no reported year value (e.g. authorized-but-unissued)
    must not block genuine-absence proof the way a valued row does."""
    native = _native_with_filings("10-K")
    native["statements"]["balance_sheet"] = [
        {"concept": "PreferredStockValue", "label": "Preferred stock, none issued", "FY 2024": None}
    ]
    annual = build_canonical_financials(native, {"currency": "USD"})["annual"]
    assert annual[0]["preferred_equity"]["source"] == "not_applicable"


def test_preferred_equity_absence_requires_filed_10k():
    market = {"currency": "USD"}
    annual_q = build_canonical_financials(_native_with_filings("10-Q"), market)["annual"]
    assert annual_q, "expected at least one annual period"
    assert annual_q[0]["preferred_equity"]["source"] == "missing", (
        "10-Q-only filing must not prove preferred-equity absence"
    )

    canonical_k = build_canonical_financials(_native_with_filings("10-K"), market)
    annual_k = canonical_k["annual"]
    assert annual_k[0]["preferred_equity"]["source"] == "not_applicable"
    assert annual_k[0]["preferred_equity"]["sources"][0]["accession"] == "0000000000-26-000001"
    # NCI keeps its filed-source proof too.
    assert annual_k[0]["non_controlling_interest"]["source"] == "not_applicable"


def _market():
    now_ms = int(time.time() * 1000)
    return {
        "current_price": 10.0,
        "beta": 1.0,
        "market_cap": 1e9,
        "shares_outstanding": 1e8,
        "fallback_used": False,
        "source": "test_live",
        "fetched_at_ms": now_ms,
    }


def _valuation_context():
    now_ms = int(time.time() * 1000)
    return {
        "risk_free_rate": 0.04,
        "equity_risk_premium": 0.05,
        "treasury_rate_source": "test_treasury",
        "erp_source": "test_erp",
        "fetched_at_ms": now_ms,
        "as_of_date": "2026-02-01",
    }


def _peer(symbol, ev, revenue):
    return {
        "symbol": symbol,
        "enterpriseValue": float(ev),
        "revenue": float(revenue),
        "evRevenue": float(ev) / float(revenue),
        "ebitda": 0.0,
    }


def test_biotech_false_readiness_stages_comparable_fallback():
    market = _market()
    latest = {
        "revenue": _ready_line(100.0),
        "ebit": _ready_line(-10.0),
        "cash": _ready_line(),
        "debt": _ready_line(),
        "marketable_securities": _na_line(),
        "non_controlling_interest": _na_line(),
        "preferred_equity": _na_line(),
        "shares": _ready_line(100.0),
    }
    canonical = {"annual": [dict(latest)], "latest": latest, "currency": "USD", "metadata": {}}
    profile = {
        "ticker": "TST",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "sic": "2836",
        "sic_description": "biological products biotech",
    }
    peers = [_peer("AAA", 1000.0, 100.0), _peer("BBB", 1200.0, 100.0), _peer("CCC", 1500.0, 100.0)]
    now_ms = int(time.time() * 1000)
    result = classify_company(
        profile,
        canonical_financials=canonical,
        market=market,
        valuation_context=_valuation_context(),
        market_status="live",
        valuation_status="live",
        native_financials={"pipeline_assets": []},
        peers=peers,
        peer_status="live",
        peer_source="derived_screener",
        peer_fallback_used=False,
        peer_fetched_at_ms=now_ms,
    )
    assert result.preferred_model == "revenue_multiple", (
        "false-readiness biotech with staged multiple must fall back, got: "
        + "; ".join(m.reason for m in result.blocked_models)
    )
    assert result.supported_by_current_engine is True
    for blocked in result.blocked_models:
        assert "MRNA" not in blocked.reason, "hardcoded exemplar label leaked into readiness"


def test_foreign_form_yields_no_telecom_facts():
    from app.services import edgar as edgar_module

    company = type("Company", (), {"cik": "0000000000"})()
    source_filings = [
        {
            "form": "20-F",
            "report_date": "2024-12-31",
            "filing_date": "2025-02-01",
            "accession_number": "0000000000-25-000001",
        }
    ]
    facts = asyncio.run(edgar_module._fetch_telecom_filing_facts(company, source_filings))
    assert facts == []


def test_500_response_carries_kind_and_request_id():
    from app.main import build_general_exception_response

    class FakeState:
        request_id = "req-123"

    class FakeRequest:
        state = FakeState()

    response = asyncio.run(build_general_exception_response(FakeRequest(), RuntimeError("boom")))
    assert response.status_code == 500
    body = response.body.decode()
    assert "req-123" in body
    assert "RuntimeError" in body
    assert "boom" not in body
