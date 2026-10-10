"""Task 2 RED: hardcoded sector-table peers must be flagged fallback (#60)."""

from __future__ import annotations

from app.services.finance import peers as peers_module


def test_sector_table_is_fallback():
    is_fallback = getattr(peers_module, "_is_fallback_peer_source", None)
    assert is_fallback is not None, "missing _is_fallback_peer_source helper"
    assert is_fallback("sector_industry_table", False, False) is True


def test_zero_industry_derived_is_fallback():
    is_fallback = getattr(peers_module, "_is_fallback_peer_source", None)
    assert is_fallback is not None, "missing _is_fallback_peer_source helper"
    assert is_fallback("derived_screener", False, True) is True


def test_curated_derived_is_not_fallback():
    is_fallback = getattr(peers_module, "_is_fallback_peer_source", None)
    assert is_fallback is not None, "missing _is_fallback_peer_source helper"
    assert is_fallback("derived_screener", False, False) is False
