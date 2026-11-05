"""Broker-dealer classification and the no-valuation status workbook.

Two failures this pins down, both ticker-agnostic:

* A broker-dealer ("Capital Markets", SIC 6211) carries no deposit vocabulary,
  so the financial-institution branch used to be skipped and the issuer was
  handed an operating-company DCF whose capital structure makes it meaningless.
* An issuer with no production valuation route used to leave the CLI with a
  status filter and no workbook. It now stages, and exports, a status workbook
  that states why no valuation was produced and carries a Data Review row.
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from app.api.contracts import DcfExportRequest
from app.services.excel_export.service import export_workbook
from app.services.runtime import OpenPyXLWorkbookAdapter
from app.services.valuation.classifier import classify_company


def _broker_dealer_profile() -> dict[str, str]:
    return {
        "ticker": "TST",
        "sector": "Financial Services",
        "industry": "Capital Markets",
        "sic": "6211",
        "sic_description": "Security Brokers, Dealers, and Flotation Companies",
    }


def test_broker_dealer_is_unsupported_not_an_operating_dcf() -> None:
    result = classify_company(_broker_dealer_profile(), canonical_financials={"latest": {}}, market={})

    assert result.company_type == "bank"
    assert result.subtype == "investment_bank"
    assert result.status == "unsupported"
    assert result.supported_by_current_engine is False
    assert result.model_route_available is False
    assert result.allowed_models == []
    assert any("broker-dealer" in model.reason for model in result.blocked_models)


def test_broker_dealer_detected_from_sic_description_alone() -> None:
    profile = {
        "ticker": "TST",
        "sector": "Financial Services",
        "sic_description": "Security Brokers, Dealers, and Flotation Companies",
    }

    result = classify_company(profile, canonical_financials={"latest": {}}, market={})

    assert result.subtype == "investment_bank"
    assert result.status == "unsupported"


def test_commercial_bank_still_offers_the_input_required_route() -> None:
    profile = {
        "ticker": "TST",
        "sector": "Financial Services",
        "industry": "Banks - Diversified",
        "sic": "6021",
        "sic_description": "National Commercial Banks",
    }

    result = classify_company(profile, canonical_financials={"latest": {}}, market={})

    assert result.subtype == "commercial_bank"
    assert result.status == "input_required"
    assert result.allowed_models == ["bank_residual_income"]


def _unsupported_payload() -> dict:
    return {
        "buildStatus": "unsupported",
        "company": {
            "name": "Test Brokers Inc",
            "ticker": "TST",
            "currency": "USD",
            "unitsScale": "millions",
            "asOfDate": "2026-11-05",
            "exchange": "NYSE",
        },
        "unsupported": {
            "companyType": "bank",
            "subtype": "investment_bank",
            "attemptedModel": "bank_residual_income",
            "reason": (
                "Investment-bank valuation is unsupported; the commercial-bank operating "
                "and capital model does not apply to broker-dealers."
            ),
        },
        "uiMeta": {"printDate": "2026-11-05", "companyName": "Test Brokers Inc"},
    }


def test_unsupported_export_rejects_valuation_inputs() -> None:
    with_valuation = _unsupported_payload()
    with_valuation["valuationModel"] = "unlevered_dcf"
    with pytest.raises(ValidationError, match="cannot select a valuation model"):
        DcfExportRequest.model_validate(with_valuation)

    with_assumptions = _unsupported_payload()
    with_assumptions["market"] = {"currentPrice": 100.0}
    with pytest.raises(ValidationError, match="cannot carry valuation inputs"):
        DcfExportRequest.model_validate(with_assumptions)

    without_reason = _unsupported_payload()
    del without_reason["unsupported"]["reason"]
    with pytest.raises(ValidationError):
        DcfExportRequest.model_validate(without_reason)

    mislabelled = _unsupported_payload()
    mislabelled["buildStatus"] = "ready"
    with pytest.raises(ValidationError, match="only valid with buildStatus=unsupported"):
        DcfExportRequest.model_validate(mislabelled)


def test_unsupported_export_stages_a_status_workbook() -> None:
    request = DcfExportRequest.model_validate(_unsupported_payload())
    payload = request.model_dump(by_alias=True, exclude_unset=True)

    class _NoPeerFetch:
        async def fetch_peer_data(self, ticker: str) -> list[dict]:
            raise AssertionError("an unsupported export must not fetch peers")

    services = SimpleNamespace(workbook=OpenPyXLWorkbookAdapter(), peers=_NoPeerFetch())
    workbook_bytes = asyncio.run(export_workbook(payload, services))
    workbook = load_workbook(BytesIO(workbook_bytes))

    assert workbook.sheetnames == ["Model Status", "Data Review"]
    status = workbook["Model Status"]
    recorded = {
        str(status.cell(row=row, column=1).value): status.cell(row=row, column=2).value
        for row in range(4, 12)
    }
    assert recorded["Build status"] == "UNSUPPORTED"
    assert recorded["Subtype"] == "investment_bank"
    assert recorded["Attempted model"] == "bank_residual_income"
    assert "broker-dealers" in recorded["Reason"]

    review_rows = [
        (row[0], row[2])
        for row in workbook["Data Review"].iter_rows(min_row=6, max_col=3, values_only=True)
        if row[0]
    ]
    assert any(
        cell_status == "REVIEW" and "no valuation produced" in (note or "")
        for cell_status, note in review_rows
    )

