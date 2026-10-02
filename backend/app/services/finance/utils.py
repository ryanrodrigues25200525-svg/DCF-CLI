from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("finance-utils")

def _low_memory_mode_enabled() -> bool:
    raw = os.getenv("LOW_MEMORY_MODE")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(os.getenv("RENDER"))

def _to_positive_float(value: Any) -> float:
    try:
        parsed = float(value or 0.0)
    except Exception:
        return 0.0
    return parsed if math.isfinite(parsed) and parsed > 0 else 0.0

def _safe_log10(value: Any) -> float:
    parsed = _to_positive_float(value)
    if parsed <= 0:
        return 0.0
    return math.log10(parsed)

def _is_financial_like_company(sector: str, industry: str) -> bool:
    text = f"{sector or ''} {industry or ''}".lower()
    keywords = (
        "financial",
        "bank",
        "insurance",
        "capital markets",
        "asset management",
        "credit services",
    )
    return any(keyword in text for keyword in keywords)

def _is_missing_numeric(value: Any) -> bool:
    try:
        parsed = float(value or 0)
        return not math.isfinite(parsed) or parsed <= 0
    except Exception:
        return True

def _is_missing_string(value: Any) -> bool:
    if value is None:
        return True
    return not str(value).strip()

def _sanitize_multiple(value: Any, *, max_value: float) -> Optional[float]:
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed) or parsed <= 0 or parsed > max_value:
        return None
    return parsed

def _coerce_datetime(val: Any) -> Optional[datetime]:
    try:
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.astimezone(timezone.utc)
        # pandas Timestamp
        if hasattr(val, "to_pydatetime"):
            return val.to_pydatetime().astimezone(timezone.utc)
        # string
        if isinstance(val, str):
            dt = datetime.fromisoformat(val)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except Exception:
        return None
    return None

def _extract_earnings_date(calendar_obj: Any) -> Optional[datetime]:
    try:
        # yfinance calendar is typically a DataFrame with index labels.
        if hasattr(calendar_obj, "index") and hasattr(calendar_obj, "loc"):
            if "Earnings Date" in calendar_obj.index:
                val = calendar_obj.loc["Earnings Date"]
                # may be a Series with 1-2 dates
                for v in getattr(val, "values", []):
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
            if "Earnings Date" in getattr(calendar_obj, "columns", []):
                val = calendar_obj["Earnings Date"]
                for v in getattr(val, "values", []):
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
        # Sometimes calendar is a dict-like
        if isinstance(calendar_obj, dict) and "Earnings Date" in calendar_obj:
            val = calendar_obj["Earnings Date"]
            if isinstance(val, (list, tuple)):
                for v in val:
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
            return _coerce_datetime(val)
    except Exception:
        return None
    return None
