"""Telecom subscriber/broadband rows must parse under both filing-text shapes.

edgartools 5.61 renders footnote markers attached to table labels
("Total Mobility Subscribers1"), while the 5.36-era SGML fallback emitted a
separated token ("Total Mobility Subscribers 1"). Row patterns must accept
both shapes and still skip header-only lines such as "Broadband Connections".
"""

from __future__ import annotations

import pytest

from app.services import edgar as edgar_svc

EXPECTED = {
    "TelecomWirelessSubscribers": [120105.0, 117851.0, 113808.0],
    "TelecomWirelessNetAdditions": [2314.0, 4168.0, 3722.0],
    "TelecomPostpaidChurn": [1.05, 0.92, 0.98],
    "TelecomPostpaidPhoneChurn": [0.90, 0.76, 0.81],
    "TelecomBroadbandConnections": [14704.0, 13987.0, 13729.0],
    "TelecomBroadbandNetAdditions": [729.0, 258.0, -24.0],
}


def _filing_text(attached: bool) -> str:
    def marker(token: str) -> str:
        return token if attached else f" {token}"

    return "\n".join(
        [
            "Mobility Results",
            "The following tables highlight other key measures of performance for Mobility:",
            f"  Total Mobility Subscribers{marker('1')}                120,105      117,851      113,808                1.9%          3.6%",
            "  Postpaid Phone Net Additions                    1,551        1,653        1,744        (6.2)%       (5.2)%",
            f"  Mobility Net Subscriber Additions{marker('2,3')}                    2,314        4,168        3,722      (44.5)%       12.0%",
            f"  Postpaid Churn{marker('4')}                    1.05%        0.92%        0.98%         13 BP        (6) BP",
            f"  Postpaid Phone Churn{marker('4')}                    0.90%        0.76%        0.81%       14 BP        (5) BP",
            "AT&T Inc.",
            "Business Wireline Results",
            "Consumer Wireline Results",
            "Broadband Connections",
            f"  Broadband{marker('1')}                    14,704       13,987       13,729       5.1%        1.9%",
            "Broadband Net Additions",
            f"  Broadband Net Additions{marker('1,2')}                    729        258       (24)      —%                  —%",
            "AT&T Inc.",
        ]
    )


@pytest.mark.parametrize("attached", [True, False], ids=["marker-attached", "marker-separated"])
def test_subscriber_and_broadband_rows_parse_in_both_shapes(attached):
    facts = edgar_svc._telecom_filing_facts_from_text(
        _filing_text(attached),
        report_date="2025-12-31",
        filing_date="2026-02-01",
        accession_number="0000732717-26-000120",
        form="10-K",
        primary_document="t-20251231.htm",
    )
    by_concept = {}
    for fact in facts:
        by_concept.setdefault(fact["concept"], []).append(fact)

    for concept, expected_year_values in EXPECTED.items():
        extracted = sorted(by_concept.get(concept, []), key=lambda f: -int(f["fiscal_year"]))
        assert [f["value"] for f in extracted] == expected_year_values, concept
        assert [int(f["fiscal_year"]) for f in extracted] == [2025, 2024, 2023], concept
