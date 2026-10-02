from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict

logger = logging.getLogger("stockdex-service")
STOCKDEX_MARKET_TIMEOUT_SECONDS = 20.0
_STOCKDEX_IMPORT_UNAVAILABLE = False


def _stockdex_enabled() -> bool:
    raw = os.getenv("STOCKDEX_ENABLED")
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_ticker(ticker_symbol: str):
    global _STOCKDEX_IMPORT_UNAVAILABLE

    if not _stockdex_enabled():
        return None
    if _STOCKDEX_IMPORT_UNAVAILABLE:
        return None
    try:
        from stockdex import Ticker  # Optional heavy dependency.
    except Exception as e:
        _STOCKDEX_IMPORT_UNAVAILABLE = True
        logger.warning("Stockdex import unavailable, disabling stockdex fallback: %s", e)
        return None
    try:
        return Ticker(ticker=ticker_symbol)
    except Exception as e:
        logger.warning("Stockdex ticker init failed for %s: %s", ticker_symbol, e)
        return None


class StockdexService:
    """
    Service wrapper for stockdex library to fetch market data and financial fallbacks.
    Acts as a replacement for yfinance and a fallback for SEC Edgar.
    """

    @staticmethod
    async def fetch_market_data(ticker_symbol: str) -> Dict[str, Any]:
        """
        Fetch market data using stockdex (Yahoo Finance sources).
        """
        try:
            ticker = _get_ticker(ticker_symbol)
            if ticker is None:
                return {}

            # Parallel fetch for various sources
            summary_task = asyncio.to_thread(lambda: ticker.yahoo_web_summary)
            highlights_task = asyncio.to_thread(lambda: ticker.yahoo_web_financial_highlights)
            price_task = asyncio.to_thread(lambda: ticker.yahoo_api_price())

            summary_df, highlights_df, price_df = await asyncio.wait_for(
                asyncio.gather(summary_task, highlights_task, price_task),
                timeout=STOCKDEX_MARKET_TIMEOUT_SECONDS,
            )

            def safe_float(v):
                if v is None:
                    return None
                if not isinstance(v, (str, float, int)):
                    return None
                try:
                    if isinstance(v, str):
                        v = v.replace('(', '').replace(')', '').replace('%', '').replace(',', '').strip()
                    return float(v)
                except (TypeError, ValueError):
                    return None

            # 1. Price from API (most reliable)
            current_price = None
            if price_df is not None and not price_df.empty:
                # Get the last non-NaN close price
                closes = price_df['close'].dropna()
                if not closes.empty:
                    current_price = float(closes.iloc[-1])

            # 2. Map summary data
            data = summary_df.iloc[:, 0].to_dict() if summary_df is not None and not summary_df.empty else {}

            # 3. Map highlights data
            highlights = highlights_df.iloc[:, 0].to_dict() if highlights_df is not None and not highlights_df.empty else {}

            # Combine and map to our internal schema
            # We prioritize summary for market_cap, but it might be in highlights too
            mkt_cap = StockdexService._parse_volume_string(data.get("marketCap")) or StockdexService._parse_volume_string(highlights.get("Market Cap (intraday)"))

            result = {
                "current_price": current_price or safe_float(data.get("regularMarketPrice")),
                "market_cap": mkt_cap,
                "shares_outstanding": safe_float(data.get("sharesOutstanding")) or (
                    (mkt_cap / (current_price or safe_float(data.get("regularMarketPrice"))))
                    if (mkt_cap and (current_price or safe_float(data.get("regularMarketPrice"))))
                    else None
                ),
                "beta": safe_float(highlights.get("Beta (5Y Monthly)")) or safe_float(data.get("beta3Year")),
                "pe_ratio": safe_float(data.get("trailingPE")),
                "dividend_yield": safe_float(data.get("dividendYield")),

                # Enriched Metrics
                "ebitda": StockdexService._parse_volume_string(highlights.get("EBITDA")),
                "revenue_ttm": StockdexService._parse_volume_string(highlights.get("Revenue  (ttm)")),
                "gross_profit_ttm": StockdexService._parse_volume_string(highlights.get("Gross Profit  (ttm)")),
                "profit_margin": safe_float(highlights.get("Profit Margin")),
                "operating_margin": safe_float(highlights.get("Operating Margin  (ttm)")),
                "total_cash": StockdexService._parse_volume_string(highlights.get("Total Cash  (mrq)")),
                "total_debt": StockdexService._parse_volume_string(highlights.get("Total Debt  (mrq)")),
                "operating_cash_flow": StockdexService._parse_volume_string(highlights.get("Operating Cash Flow  (ttm)")),
                "fcf_ttm": StockdexService._parse_volume_string(highlights.get("Levered Free Cash Flow  (ttm)")),
                "source": "stockdex",
            }
            return {k: v for k, v in result.items() if v is not None}
        except Exception as e:
            logger.warning(f"Stockdex market data fetch failed for {ticker_symbol}: {e}")
            return {}

    @staticmethod
    def _parse_volume_string(val: Any) -> float:
        """Parse strings like '4.089T', '125.5B' or '500M' into float."""
        if not isinstance(val, str):
            return float(val) if val is not None else 0.0

        val = val.strip().upper()
        multiplier = 1.0
        if 'T' in val:
            multiplier = 1_000_000_000_000.0
            val = val.replace('T', '')
        elif 'B' in val:
            multiplier = 1_000_000_000.0
            val = val.replace('B', '')
        elif 'M' in val:
            multiplier = 1_000_000.0
            val = val.replace('M', '')

        try:
            return float(val.replace(',', '')) * multiplier
        except (TypeError, ValueError):
            return 0.0
