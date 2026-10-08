"""Task 1 RED: description/industry-identified filers must pass fetch gates (#61, #62, #46)."""

from __future__ import annotations

from app.services import edgar as edgar_module


def _company(sic="", industry="", sic_description="", name=""):
    return type(
        "Company", (), {"sic": sic, "industry": industry, "sic_description": sic_description, "name": name}
    )()


def test_description_identified_biotech_fetches_pipeline():
    company = _company(sic="9999", industry="Biotechnology", sic_description="biotechnology company")
    assert edgar_module._is_biotech_filer(company) is True


def test_description_identified_pharma_fetches():
    company = _company(sic="9999", industry="Drug Manufacturers", sic_description="pharmaceutical preparations")
    assert edgar_module._is_pharma_filer(company) is True


def test_description_identified_energy_fetches():
    company = _company(sic="9999", industry="Oil & Gas Integrated", sic_description="petroleum refining energy")
    assert edgar_module._is_energy_filer(company) is True


def test_asset_manager_industry_gate():
    company = _company(sic="9999", industry="Asset Management", sic_description="investment advice")
    gate = getattr(edgar_module, "_is_asset_manager_filer", None)
    assert gate is not None, "missing _is_asset_manager_filer helper"
    assert gate(company) is True


def test_telecom_4812_fetch():
    gate = getattr(edgar_module, "_is_telecom_filer", None)
    assert gate is not None, "missing _is_telecom_filer helper"
    assert gate(_company(sic="4812")) is True
    assert gate(_company(sic="4813")) is True


def test_description_identified_telecom_fetches():
    gate = getattr(edgar_module, "_is_telecom_filer", None)
    assert gate is not None, "missing _is_telecom_filer helper"
    company = _company(sic="9999", industry="Telecom Services", sic_description="wireless carrier")
    assert gate(company) is True


def test_sic_gates_still_hold():
    assert edgar_module._is_energy_filer(_company(sic="2911")) is True
    assert edgar_module._is_pharma_filer(_company(sic="2834")) is True
    assert edgar_module._is_biotech_filer(_company(sic="2836")) is True
