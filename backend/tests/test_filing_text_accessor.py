"""Filing-text accessor must tolerate installed-edgartools homepage-index drift.

edgartools 5.36.0 `Filing.text()`/`html()` dereference
`homepage.primary_html_document` without a None guard; for recent 10-K
filings the homepage index carries zero documents, so both raise
`AttributeError: 'NoneType' object has no attribute 'download'` and every
filing-text fetcher starves. The resilient accessors must render from
SGML-derived HTML instead.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from app.services import edgar as edgar_svc

DRIFT_ERROR = AttributeError("'NoneType' object has no attribute 'download'")

HTML = (
    "<html><body><div>"
    "<p>Consolidated Statements of Income (in millions)</p>"
    "<p>Total noninterest income $ 12,345</p>"
    "<p>Total noninterest expense $ 9,876</p>"
    "<p>Provision for credit losses $ 1,234</p>"
    "</div></body></html>"
)


def _drifted_filing(html: str = HTML) -> MagicMock:
    """Filing shaped like installed edgartools 5.36.0 on a recent 10-K."""
    filing = MagicMock()
    filing.form = "10-K"
    filing.text.side_effect = DRIFT_ERROR
    filing.html.side_effect = DRIFT_ERROR
    sgml = MagicMock()
    sgml.html.return_value = html
    filing.sgml.return_value = sgml
    return filing


def test_resilient_text_survives_homepage_drift():
    text = edgar_svc._resilient_filing_text(_drifted_filing())
    assert "Total noninterest income" in text
    assert "12,345" in text


def test_resilient_html_falls_back_to_sgml():
    assert edgar_svc._resilient_filing_html(_drifted_filing()) == HTML


def test_financial_institution_facts_survive_drift():
    filing = _drifted_filing()
    filings = MagicMock()
    filings.get.return_value = filing
    company = MagicMock()
    company.get_filings.return_value = filings
    source = [{
        "form": "10-K",
        "filing_date": "2026-02-19",
        "report_date": "2025-12-31",
        "accession_number": "0000000000-26-000001",
        "primary_document": "test-10k.htm",
    }]
    bank, _, _ = asyncio.run(
        edgar_svc._fetch_financial_institution_filing_facts(company, source, "TST")
    )
    concepts = {fact["concept"] for fact in bank}
    assert "BankNoninterestIncome" in concepts
