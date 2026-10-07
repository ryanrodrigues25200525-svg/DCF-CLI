from __future__ import annotations

import time

from openpyxl.workbook import Workbook

from app.services.excel_export.mappers.comparable_model import apply_comparable_model


def _payload() -> dict:
    now_ms = int(time.time() * 1000)
    return {
        "valuationModel": "ev_ebitda",
        "company": {"ticker": "TGT", "name": "Target Co", "unitsScale": "millions"},
        "market": {
            "currentPrice": 50.0,
            "sharesDiluted": 100.0,
            "cash": 10.0,
            "debt": 5.0,
            "nonOperatingAssets": 0.0,
            "minorityInterest": 0.0,
            "preferredEquity": 0.0,
        },
        "historicals": {"years": [2023, 2024], "income": {"EBITDA": [90.0, 100.0]}},
        "comparableModel": {
            "method": "ev_ebitda",
            # Median of the emitted set (10x, 12x, 20x) is 12x.
            "selectedMultiple": 12.0,
            "peersUsedForMedian": ["AAA", "BBB", "CCC"],
            "peerStatus": "live",
            "peerSource": "curated",
            "peerFallbackUsed": False,
            "peerFetchedAtMs": now_ms,
        },
        "comps": [
            {"ticker": "AAA", "company": "A", "ev": 1000.0, "revenue": 500.0, "ebitda": 100.0},
            {"ticker": "BBB", "company": "B", "ev": 1200.0, "revenue": 600.0, "ebitda": 100.0},
            {"ticker": "CCC", "company": "C", "ev": 2000.0, "revenue": 800.0, "ebitda": 100.0},
            # Divergent peer present in comps but NOT in the emitted set: the
            # mapper must ignore it instead of reconciling against it.
            {"ticker": "ZZZ", "company": "Z", "ev": 9000.0, "revenue": 900.0, "ebitda": 100.0},
        ],
    }


def test_mapper_consumes_emitted_peer_set() -> None:
    workbook = Workbook()
    apply_comparable_model(workbook, _payload())

    model = workbook["Comparable Valuation"]
    tickers = [model.cell(row=row, column=1).value for row in range(24, 27)]
    assert tickers == ["AAA", "BBB", "CCC"]
    # B5 median formula spans exactly the three emitted peers.
    assert model["B5"].value == "=MEDIAN(G24:G26)"
