from __future__ import annotations

from app.services.finance.peers import (
    _exclude_foreign_reporters,
    _industry_match_count,
    _reports_in_usd,
)


def _peer(symbol: str, currency: str | None, industry: str) -> dict:
    peer: dict = {"symbol": symbol, "industry": industry}
    if currency is not None:
        peer["financialCurrency"] = currency
    return peer


def test_derived_peers_exclude_foreign_filers() -> None:
    # ASX/IFNNY-style 20-F candidates: present non-USD reporting currency.
    peers = [
        _peer("TXN", "USD", "Semiconductors"),
        _peer("ASX", "TWD", "Semiconductors"),
        _peer("IFNNY", "EUR", "Semiconductors"),
        _peer("MPWR", None, "Semiconductors"),  # missing currency stays (fail-open)
    ]
    kept, excluded = _exclude_foreign_reporters(peers)
    assert {p["symbol"] for p in kept} == {"TXN", "MPWR"}
    assert excluded == {"ASX", "IFNNY"}


def test_reports_in_usd_fail_open() -> None:
    assert _reports_in_usd({"symbol": "X"}) is True
    assert _reports_in_usd({"symbol": "X", "financialCurrency": ""}) is True
    assert _reports_in_usd({"symbol": "X", "financialCurrency": "USD"}) is True
    assert _reports_in_usd({"symbol": "X", "financialCurrency": "TWD"}) is False


def test_industry_match_count_uses_ranking_rule() -> None:
    peers = [
        _peer("A", "USD", "Semiconductors"),
        _peer("B", "USD", "Semiconductor Equipment"),
    ]
    assert _industry_match_count(peers, "Semiconductors") == 1
    assert _industry_match_count(peers, "Cruise Lines") == 0
