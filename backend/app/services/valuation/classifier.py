from __future__ import annotations

from typing import Any, Dict


def _text(*parts: Any) -> str:
    return " ".join(str(part or "") for part in parts).lower()


def classify_company(profile: Dict[str, Any] | None, canonical_financials: Dict[str, Any] | None = None) -> Dict[str, Any]:
    profile = profile or {}
    canonical_financials = canonical_financials or {}
    ticker = str(profile.get("ticker") or "").upper()
    text = _text(profile.get("sector"), profile.get("industry"), profile.get("sic"), profile.get("sic_description"))
    latest = canonical_financials.get("latest") or {}
    metadata = canonical_financials.get("metadata") or {}

    revenue = float((latest.get("revenue") or {}).get("value") or 0)
    ebit = float((latest.get("ebit") or {}).get("value") or 0)
    debt = float((latest.get("debt") or {}).get("value") or 0)
    book_value = float((latest.get("book_value") or {}).get("value") or 0)
    debt_to_book = debt / book_value if book_value > 0 else 0

    if metadata.get("is_financial_institution") or any(token in text for token in ("bank", "depository", "commercial banks", "savings institution", "credit services")):
        return {
            "company_type": "bank",
            "preferred_model": "residual_income",
            "allowed_models": ["residual_income", "ddm", "ptbv"],
            "blocked_models": [{"model": "unlevered_dcf", "reason": "Bank debt is operating capital; FCFF enterprise-value DCF is not appropriate."}],
            "supported_by_current_engine": True,
        }

    if ticker in {"BRK.A", "BRK-B", "BRK.B"} or any(token in text for token in ("insurance", "reinsurance", "property casualty", "life insurance", "casualty insurance")):
        return {
            "company_type": "insurance",
            "preferred_model": "residual_income",
            "allowed_models": ["residual_income", "ddm", "pbv"],
            "blocked_models": [{"model": "unlevered_dcf", "reason": "Insurance valuation should be book-value and ROE based."}],
            "supported_by_current_engine": True,
        }

    if any(token in text for token in ("reit", "real estate investment trust")):
        return {
            "company_type": "reit",
            "preferred_model": "reit_affo",
            "allowed_models": ["reit_affo", "nav", "dividend_yield"],
            "blocked_models": [{"model": "unlevered_dcf", "reason": "REIT depreciation and FFO/AFFO economics make generic FCFF unreliable."}],
            "supported_by_current_engine": True,
        }

    if any(token in text for token in ("electric", "utility", "utilities", "gas utility", "water utility", "regulated")):
        return {
            "company_type": "utility",
            "preferred_model": "utility_dcf",
            "allowed_models": ["utility_dcf", "ddm"],
            "blocked_models": [{"model": "unlevered_dcf", "reason": "Regulated utilities need capex/debt/rate-base aware valuation."}],
            "supported_by_current_engine": True,
        }

    if revenue > 0 and ebit <= 0:
        distressed = debt_to_book > 3
        return {
            "company_type": "distressed" if distressed else "high_growth",
            "preferred_model": "ev_ebitda" if distressed else "revenue_multiple",
            "allowed_models": ["revenue_multiple", "ev_ebitda", "staged_dcf"],
            "blocked_models": [],
            "supported_by_current_engine": True,
        }

    return {
        "company_type": "operating",
        "preferred_model": "unlevered_dcf",
        "allowed_models": ["unlevered_dcf", "ev_ebitda", "revenue_multiple"],
        "blocked_models": [],
        "supported_by_current_engine": True,
    }
