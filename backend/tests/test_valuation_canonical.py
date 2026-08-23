from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.valuation import build_canonical_financials, classify_company


def _native_payload():
    return {
        "ticker": "TEST",
        "key_metrics": {"shares_outstanding_diluted": 1000},
        "statements": {
            "income_statement": [
                {"concept": "Revenues", "standard_concept": "Revenue", "FY 2025": 10000},
                {"concept": "OtherNonoperatingIncomeExpense", "standard_concept": "Non-Operating Income (Expense)", "FY 2025": -50},
                {"concept": "NetIncomeLoss", "standard_concept": "Net Income", "FY 2025": 1200},
                {"concept": "IncomeTaxExpenseBenefit", "standard_concept": "Income Tax Expense", "FY 2025": 300},
                {"concept": "InterestExpenseNonoperating", "standard_concept": "Interest Expense", "FY 2025": 100},
            ],
            "balance_sheet": [
                {"concept": "CashAndCashEquivalentsAtCarryingValue", "standard_concept": "CashAndCashEquivalents", "FY 2025": 500},
                {"concept": "LongTermDebtNoncurrent", "standard_concept": "LongTermDebt", "FY 2025": 2000},
                {"concept": "StockholdersEquity", "standard_concept": "StockholdersEquity", "FY 2025": 4000},
            ],
            "cashflow_statement": [
                {"concept": "NetCashProvidedByUsedInOperatingActivities", "standard_concept": "NetCashFromOperatingActivities", "FY 2025": 1800},
                {"concept": "PaymentsToAcquirePropertyPlantAndEquipment", "standard_concept": "PaymentsToAcquirePropertyPlantAndEquipment", "FY 2025": -700},
            ],
        },
    }


def test_canonical_financials_derive_ebit_and_preserve_provenance():
    canonical = build_canonical_financials(_native_payload(), {"current_price": 10, "market_cap": 10000})

    latest = canonical["latest"]

    assert latest["revenue"]["value"] == 10000
    assert latest["ebit"]["value"] == 1600
    assert latest["ebit"]["method"] == "pretax_plus_interest"
    assert latest["capex"]["value"] == 700
    assert latest["shares"]["value"] == 1000
    assert canonical["quality"]["has_capex"] is True


def test_classifier_routes_company_types_from_profile_text():
    canonical = build_canonical_financials(_native_payload(), {"current_price": 10, "market_cap": 10000})

    bank = classify_company({"ticker": "JPM", "industry": "National Commercial Banks"}, canonical)
    reit = classify_company({"ticker": "PLD", "industry": "Real Estate Investment Trusts"}, canonical)
    utility = classify_company({"ticker": "NEE", "industry": "Electric Services"}, canonical)
    operating = classify_company({"ticker": "AAPL", "industry": "Electronic Computers"}, canonical)

    assert bank["company_type"] == "bank"
    assert bank["preferred_model"] == "residual_income"
    assert reit["company_type"] == "reit"
    assert reit["preferred_model"] == "reit_affo"
    assert utility["company_type"] == "utility"
    assert operating["company_type"] == "operating"
