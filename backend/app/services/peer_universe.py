from __future__ import annotations

"""Curated peer fallback lists used by comps-related services."""

CURATED_PEERS = {
    "AAPL": ["SONY", "DELL", "HPQ", "LOGI"],
    "MSFT": ["AAPL", "GOOGL", "ORCL", "CRM"],
    "GOOGL": ["META", "MSFT", "AMZN", "NFLX"],
    "GOOG": ["META", "MSFT", "AMZN", "NFLX"],
    "AMZN": ["WMT", "TGT", "COST", "EBAY"],
    "TSLA": ["GM", "F", "TM", "RACE"],
    "META": ["GOOGL", "SNAP", "PINS", "NET"],
    "NVDA": ["AMD", "INTC", "QCOM", "AVGO"],
    "CRM": ["NOW", "ORCL", "ADBE", "INTU", "MSFT"],
    "SNOW": ["NOW", "CRM", "ORCL", "ADBE", "INTU", "MSFT"],
    "WMT": ["COST", "TGT", "KR", "DG", "DLTR"],
    "CAT": ["DE", "CMI", "PCAR", "AGCO", "CNH"],
    "JPM": ["BAC", "WFC", "C", "GS"],
    "JNJ": ["PFE", "MRK", "ABBV", "BMY"],
    "XOM": ["CVX", "COP", "SLB", "EOG"],
    "PG": ["CL", "KMB", "CHD", "GIS"],
    "SEZL": ["AFRM", "PYPL", "XYZ", "SOFI"],
}
