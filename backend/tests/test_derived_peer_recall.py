"""Tests for derived peer recall improvement (#65 follow-up to #40).

Verifies that within a coarse sector, industry vocabulary and auditable SIC
candidate sets allow the screener to prioritize business-comparable peers (such
as LOW and FND for HD), while unmapped industries gracefully fall back to the
sector screener and zero-industry-match sets continue to fail closed.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.services.finance import peers as peers_module
from app.services.finance.peers import (
    _derive_peer_symbols_from_screener,
    _industry_match_count,
    _industry_slug,
    _rank_peer_details,
    fetch_peer_data_bundle,
)


def test_industry_slug_mapping_display_names() -> None:
    # Common Yahoo Finance human-readable industry names
    assert _industry_slug("Home Improvement Retail") == "home_improvement_retail"
    assert _industry_slug("home improvement") == "home_improvement_retail"
    assert _industry_slug("Semiconductors") == "semiconductors"
    assert _industry_slug("Consumer Electronics") == "consumer_electronics"
    assert _industry_slug("Banks - Diversified") == "banks"
    assert _industry_slug("Banks - Regional") == "banks"
    assert _industry_slug("Software - Application") == "software_and_services"
    assert _industry_slug("Software - Infrastructure") == "software_and_services"
    assert _industry_slug("Telecom Services") == "telecom_services"
    assert _industry_slug("Telecommunication Services") == "telecom_services"
    assert _industry_slug("Oil & Gas Integrated") == "oil_gas_integrated"
    assert _industry_slug("Oil & Gas E&P") == "oil_gas_e_p"
    assert _industry_slug("Healthcare Plans") == "healthcare_plans"
    assert _industry_slug("Biotechnology") == "biotechnology"
    assert _industry_slug("Aerospace & Defense") == "aerospace_defense"
    assert _industry_slug("Discount Stores") == "discount_stores"


def test_industry_slug_mapping_sic_codes_and_descriptions() -> None:
    # Auditable SIC codes from filings (#65)
    assert _industry_slug("5211") == "home_improvement_retail"
    assert _industry_slug("Lumber & Other Building Materials Dealers") == "home_improvement_retail"
    assert _industry_slug("3674") == "semiconductors"
    assert _industry_slug("Semiconductors & Related Devices") == "semiconductors"
    assert _industry_slug("7372") == "software_and_services"
    assert _industry_slug("Prepackaged Software") == "software_and_services"
    assert _industry_slug("4813") == "telecom_services"
    assert _industry_slug("6021") == "banks"
    assert _industry_slug("1311") == "oil_gas_e_p"
    assert _industry_slug("2834") == "biotechnology"
    assert _industry_slug("3721") == "aerospace_defense"
    assert _industry_slug("5331") == "discount_stores"


def test_industry_slug_unmapped_returns_none() -> None:
    # Unmapped industries return None safely without raising exceptions
    assert _industry_slug("Beverages - Non-Alcoholic") is None
    assert _industry_slug("") is None
    assert _industry_slug(None) is None  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_derive_peer_symbols_prioritizes_industry_candidates() -> None:
    # Real #40 example: HD target ($300B cap) in consumer cyclical.
    # Without industry vocabulary, screener produced cruise lines and delivery:
    # DASH, RCL, TSLA, VIK, CCL, GPC.
    # With industry vocabulary, LOW ($110B) and FND ($5B) are prioritized.
    ind_df = pd.DataFrame([
        {"symbol": "LOW", "market_cap": 110_000_000_000.0},
        {"symbol": "HD", "market_cap": 300_000_000_000.0},  # target itself (must be excluded)
        {"symbol": "FND", "market_cap": 5_000_000_000.0},
    ])
    sec_df = pd.DataFrame([
        {"symbol": "TSLA", "market_cap": 310_000_000_000.0},
        {"symbol": "RCL", "market_cap": 320_000_000_000.0},
        {"symbol": "DASH", "market_cap": 350_000_000_000.0},
        {"symbol": "VIK", "market_cap": 300_000_000_000.0},
        {"symbol": "CCL", "market_cap": 290_000_000_000.0},
        {"symbol": "GPC", "market_cap": 280_000_000_000.0},
        {"symbol": "LOW", "market_cap": 110_000_000_000.0},
    ])

    import openbb.package.equity

    def mock_screener(self: Any, *args: Any, **kwargs: Any) -> MagicMock:
        res = MagicMock()
        if kwargs.get("industry") == "home_improvement_retail":
            res.to_df.return_value = ind_df
        else:
            res.to_df.return_value = sec_df
        return res

    with patch.object(openbb.package.equity.ROUTER_equity, "screener", mock_screener):
        with patch.object(peers_module, "_sec_filer_tickers", return_value={"LOW", "HD", "FND", "TSLA", "RCL", "DASH", "VIK", "CCL", "GPC"}):
            symbols = await _derive_peer_symbols_from_screener(
                ticker="HD",
                sector="consumer cyclical",
                target_market_cap=300_000_000_000.0,
                limit=6,
                industry="Home Improvement Retail",
            )

    # Industry candidates LOW and FND are prioritized first, supplemented by sector candidates
    assert symbols[0] == "LOW"
    assert symbols[1] == "FND"
    assert len(symbols) == 6
    assert "HD" not in symbols


@pytest.mark.asyncio
async def test_derive_peer_symbols_fallback_when_unmapped() -> None:
    # When industry is unmapped or None, falls back to sector query
    sec_df = pd.DataFrame([
        {"symbol": "KO", "market_cap": 250_000_000_000.0},
        {"symbol": "PEP", "market_cap": 240_000_000_000.0},
        {"symbol": "MNST", "market_cap": 50_000_000_000.0},
    ])

    import openbb.package.equity

    def mock_screener(self: Any, *args: Any, **kwargs: Any) -> MagicMock:
        assert "industry" not in kwargs or kwargs["industry"] is None
        res = MagicMock()
        res.to_df.return_value = sec_df
        return res

    with patch.object(openbb.package.equity.ROUTER_equity, "screener", mock_screener):
        with patch.object(peers_module, "_sec_filer_tickers", return_value={"KO", "PEP", "MNST"}):
            symbols = await _derive_peer_symbols_from_screener(
                ticker="KO",
                sector="consumer defensive",
                target_market_cap=250_000_000_000.0,
                limit=4,
                industry="Beverages - Non-Alcoholic",  # unmapped
            )

    assert "PEP" in symbols
    assert "MNST" in symbols
    assert "KO" not in symbols


def test_rank_peer_details_boosts_industry_matches() -> None:
    peers = [
        {
            "symbol": "DASH",
            "sector": "Consumer Cyclical",
            "industry": "Internet Retail",
            "marketCap": 300_000_000_000.0,
            "evRevenue": 5.0,
            "evEbitda": 20.0,
        },
        {
            "symbol": "LOW",
            "sector": "Consumer Cyclical",
            "industry": "Home Improvement Retail",
            "marketCap": 110_000_000_000.0,
            "evRevenue": 2.0,
            "evEbitda": 12.0,
        },
    ]

    ranked = _rank_peer_details(
        peers=peers,
        target_ticker="HD",
        target_market_cap=300_000_000_000.0,
        target_sector="Consumer Cyclical",
        target_industry="Home Improvement Retail",
    )

    # Despite DASH having closer market cap ($300B vs $300B), LOW wins because of industry match (+2.4 score boost)
    assert ranked[0]["symbol"] == "LOW"
    assert ranked[1]["symbol"] == "DASH"


def test_industry_match_count_accepts_equivalent_slugs() -> None:
    peers = [
        {"symbol": "A", "industry": "Home Improvement Stores"},
        {"symbol": "B", "industry": "Home Improvement Retail"},
        {"symbol": "C", "industry": "Auto Manufacturers"},
    ]
    # Both A and B map to "home_improvement_retail" slug
    assert _industry_match_count(peers, "Home Improvement Retail") == 2
    assert _industry_match_count(peers, "Auto Manufacturers") == 1
    assert _industry_match_count(peers, "Semiconductors") == 0


@pytest.mark.asyncio
async def test_derived_set_with_industry_matches_is_not_fallback() -> None:
    # End-to-end check: When derived screener finds industry matches,
    # fallback_used is False and the set is eligible for ready median.
    mock_market_data = {
        "sector": "Consumer Cyclical",
        "industry": "Home Improvement Retail",
        "market_cap": 300_000_000_000.0,
    }

    mock_peer_details = [
        {
            "symbol": "LOW",
            "sector": "Consumer Cyclical",
            "industry": "Home Improvement Retail",
            "marketCap": 110_000_000_000.0,
            "enterpriseValue": 130_000_000_000.0,
            "financialCurrency": "USD",
            "evRevenue": 1.8,
            "evEbitda": 11.5,
        },
        {
            "symbol": "FND",
            "sector": "Consumer Cyclical",
            "industry": "Home Improvement Retail",
            "marketCap": 5_000_000_000.0,
            "enterpriseValue": 6_000_000_000.0,
            "financialCurrency": "USD",
            "evRevenue": 1.5,
            "evEbitda": 10.0,
        },
        {
            "symbol": "TJX",
            "sector": "Consumer Cyclical",
            "industry": "Apparel Retail",
            "marketCap": 120_000_000_000.0,
            "enterpriseValue": 125_000_000_000.0,
            "financialCurrency": "USD",
            "evRevenue": 2.2,
            "evEbitda": 13.0,
        },
        {
            "symbol": "ROST",
            "sector": "Consumer Cyclical",
            "industry": "Apparel Retail",
            "marketCap": 50_000_000_000.0,
            "enterpriseValue": 52_000_000_000.0,
            "financialCurrency": "USD",
            "evRevenue": 2.0,
            "evEbitda": 12.0,
        },
    ]

    with patch("app.services.finance.market.fetch_market_data", return_value=mock_market_data):
        with patch.object(peers_module, "_derive_peer_symbols_from_screener", return_value=["LOW", "FND", "TJX", "ROST"]):
            with patch.object(peers_module, "_fetch_peer_details", return_value=mock_peer_details):
                bundle = await fetch_peer_data_bundle("HD")

    assert bundle["source"] == "derived_screener"
    assert bundle["fallback_used"] is False
    assert bundle["peers"][0]["symbol"] == "LOW"
    assert bundle["peers"][1]["symbol"] == "FND"
    # No warning about missing industry matches
    assert bundle["notes"] is None
